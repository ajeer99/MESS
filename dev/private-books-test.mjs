import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Node 22: node --test dev/private-books-test.mjs
// No network, environment credentials, SDK mocks, or persistent database files.
// Each test applies the unmodified migration to its own in-memory PostgreSQL.
// Only Supabase's auth table/subject helper are stubbed. Role grants and RLS are real.
// PGlite has one connection: concurrency/lock scheduling and deployed Supabase
// enforcement are NOT established by these tests.
const migration = readFileSync(new URL("../supabase/001-private-books.sql", import.meta.url), "utf8");
const users = {
  alice: "10000000-0000-4000-8000-000000000001",
  bob: "10000000-0000-4000-8000-000000000002",
  chris: "10000000-0000-4000-8000-000000000003",
  dana: "10000000-0000-4000-8000-000000000004",
};
const books = {
  alice: "20000000-0000-4000-8000-000000000001",
  other: "20000000-0000-4000-8000-000000000002",
  bob: "20000000-0000-4000-8000-000000000003",
  invalid: "20000000-0000-4000-8000-000000000004",
};
// Deliberately predictable LOCAL fixtures, not usable production invite secrets.
const token = "a".repeat(64);
const rotatedToken = "b".repeat(64);
const unknownToken = "c".repeat(64);
const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const rows = async (db, sql, values = []) => (await db.query(sql, values)).rows;
const scalar = async (db, sql, values = []) => Object.values((await rows(db, sql, values))[0])[0];
const rejected = (operation, code, message) => assert.rejects(operation, (error) => {
  assert.equal(error.code, code, error.message);
  if (message) assert.equal(error.message, message);
  return true;
});

async function fixture(t) {
  const db = new PGlite(); // No dataDir: every instance has a separate volatile database.
  t.after(() => db.close());
  await db.exec(`
    create role anon nologin nosuperuser nobypassrls;
    create role authenticated nologin nosuperuser nobypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    revoke all on function auth.uid() from public;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const id of Object.values(users)) {
    await db.query("insert into auth.users (id) values ($1)", [id]);
  }
  await db.exec(migration);
  return db;
}

async function asUser(db, subject, run, role = "authenticated") {
  assert.ok(role === "authenticated" || role === "anon");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [subject ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    assert.deepEqual(await rows(db, `
      select current_user as role, auth.uid() as subject, rolsuper, rolbypassrls
      from pg_catalog.pg_roles where rolname = current_user
    `), [{ role, subject, rolsuper: false, rolbypassrls: false }]);
    return await run(db);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

// INR/equal are explicit sample selections, not invented SQL parameter defaults.
const createBook = (db, id, overrides = {}) => {
  const input = { name: "Shared book", currency: "INR", split: "equal", display: "Alice", ...overrides };
  return scalar(db, "select public.create_expense_book($1, $2, $3, $4, $5)",
    [id, input.name, input.currency, input.split, input.display]);
};
const invite = (db, id, value = token) => scalar(db, "select public.create_book_invite($1, $2)", [id, value]);
const revoke = (db, id) => db.query("select public.revoke_book_invite($1)", [id]);
const accept = (db, value = token, name = "Chris") => scalar(db, "select public.accept_book_invite($1, $2)", [value, name]);
const visibleBooks = (db) => rows(db, "select id, owner_id from public.expense_books order by id");
const visibleMembers = (db) => rows(db, "select book_id, user_id, role from public.book_members order by book_id, user_id");

async function seedBook(db, subject = users.alice, id = books.alice) {
  await asUser(db, subject, (session) => createBook(session, id));
}

async function denyDirectWrites(db) {
  for (const [table, key] of [["expense_books", "id"], ["book_members", "id"], ["book_invitations", "book_id"]]) {
    for (const sql of [
      `insert into public.${table} default values`,
      `update public.${table} set ${key} = ${key}`,
      `delete from public.${table}`,
      `truncate public.${table}`,
    ]) {
      await rejected(() => db.query(sql), "42501");
    }
  }
}

test("migration installs RLS and restricted, empty-search-path security definers", async (t) => {
  const db = await fixture(t);
  const tables = await rows(db, `
    select relname, relrowsecurity from pg_catalog.pg_class
    where oid in ('public.expense_books'::regclass, 'public.book_members'::regclass,
                  'public.book_invitations'::regclass) order by relname
  `);
  assert.deepEqual(tables, [
    { relname: "book_invitations", relrowsecurity: true },
    { relname: "book_members", relrowsecurity: true },
    { relname: "expense_books", relrowsecurity: true },
  ]);
  const functions = await rows(db, `
    select p.proname, p.prosecdef, p.proconfig,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
      exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
      pg_get_userbyid(p.proowner) not in ('anon', 'authenticated') as trusted_owner
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'partners_private' and p.proname = 'is_book_member')
       or (n.nspname = 'public' and p.proname in
           ('create_expense_book', 'create_book_invite', 'revoke_book_invite', 'accept_book_invite'))
    order by p.proname
  `);
  assert.equal(functions.length, 5);
  for (const { proname, ...security } of functions) {
    assert.deepEqual(security, {
      prosecdef: true, proconfig: ['search_path=""'], anon_execute: false,
      authenticated_execute: true, public_execute: false, trusted_owner: true,
    }, proname);
  }
  assert.equal(await scalar(db, "select has_schema_privilege('authenticated', 'partners_private', 'CREATE')"), false);
});

test("anonymous access, subjectless RPCs, and direct authenticated writes are denied", async (t) => {
  const db = await fixture(t);
  await seedBook(db);
  await asUser(db, users.alice, (session) => invite(session, books.alice));
  const rpcCalls = (session) => [
    () => createBook(session, books.other),
    () => invite(session, books.alice),
    () => revoke(session, books.alice),
    () => accept(session),
  ];
  await asUser(db, null, async (session) => {
    for (const table of ["expense_books", "book_members", "book_invitations"]) {
      await rejected(() => session.query(`select * from public.${table}`), "42501");
    }
    await denyDirectWrites(session);
    for (const call of rpcCalls(session)) await rejected(call, "42501");
    await rejected(() => session.query("select partners_private.is_book_member($1)", [books.alice]), "42501");
  }, "anon");
  await asUser(db, null, async (session) => {
    assert.deepEqual(await visibleBooks(session), []);
    assert.deepEqual(await visibleMembers(session), []);
    for (const call of rpcCalls(session)) await rejected(call, "42501", "login_required");
  });
  await asUser(db, users.alice, async (session) => {
    await denyDirectWrites(session); // Even the book owner cannot bypass the RPCs.
    await rejected(() => session.query("select * from public.book_invitations"), "42501");
    await rejected(() => session.query("select token_hash from public.book_invitations"), "42501");
  });
});

test("unrelated users see only their own books and a user can own multiple books", async (t) => {
  const db = await fixture(t);
  await seedBook(db);
  await seedBook(db, users.alice, books.other);
  await seedBook(db, users.bob, books.bob);
  for (const [subject, ids] of [[users.alice, [books.alice, books.other]], [users.bob, [books.bob]]]) {
    await asUser(db, subject, async (session) => {
      assert.deepEqual(await visibleBooks(session), ids.map((id) => ({ id, owner_id: subject })));
      assert.deepEqual(await visibleMembers(session), ids.map((book_id) => ({ book_id, user_id: subject, role: "owner" })));
      const foreignBook = subject === users.alice ? books.bob : books.alice;
      assert.equal(await scalar(session, "select partners_private.is_book_member($1)", [foreignBook]), false);
      assert.deepEqual(await rows(session, "select * from public.expense_books where id = $1", [foreignBook]), []);
      await rejected(() => createBook(session, foreignBook), "42501", "access_denied");
      await rejected(() => invite(session, foreignBook), "42501", "access_denied");
      await rejected(() => revoke(session, foreignBook), "42501", "access_denied");
    });
  }
});

test("book and owner are transactional; exact retries are idempotent and changed book fields conflict", async (t) => {
  const db = await fixture(t);
  await asUser(db, users.alice, async (session) => {
    await session.exec("begin");
    try {
      assert.equal(await createBook(session, books.alice), books.alice);
      assert.equal((await visibleBooks(session)).length, 1);
      assert.deepEqual(await visibleMembers(session), [{ book_id: books.alice, user_id: users.alice, role: "owner" }]);
    } finally {
      await session.exec("rollback");
    }
    assert.deepEqual(await visibleBooks(session), []);
    assert.deepEqual(await visibleMembers(session), []);
    await createBook(session, books.alice);
    const before = await rows(session, "select * from public.book_members");
    assert.equal(await createBook(session, books.alice), books.alice);
    for (const change of [{ name: "Different" }, { currency: "USD" }, { split: "personal" }]) {
      await rejected(() => createBook(session, books.alice, change), "22023", "operation_conflict");
    }
    assert.deepEqual(await rows(session, "select * from public.book_members"), before);
    assert.equal((await visibleBooks(session)).length, 1);
  });
  // Administrative inspection is only for proving no hidden orphan survived rollback.
  assert.equal(await scalar(db, "select count(*)::int from public.expense_books"), 1);
  assert.equal(await scalar(db, "select count(*)::int from public.book_members"), 1);
});

test("a conflicting owner display name must not silently succeed on an idempotency key", async (t) => {
  const db = await fixture(t);
  await seedBook(db);
  await asUser(db, users.alice, async (session) => {
    await rejected(() => createBook(session, books.alice, { display: "Different owner name" }),
      "22023", "operation_conflict");
  });
});

test("reusable invites join callers as themselves; group membership is visible but tokens are not", async (t) => {
  const db = await fixture(t);
  await seedBook(db);
  await seedBook(db, users.alice, books.other);
  await seedBook(db, users.bob, books.bob);
  await asUser(db, users.alice, (session) => invite(session, books.alice));
  for (const [subject, name] of [[users.chris, "Chris"], [users.dana, "Dana"]]) {
    await asUser(db, subject, async (session) => {
      assert.deepEqual(await visibleBooks(session), []);
      assert.deepEqual(await visibleMembers(session), []);
      assert.equal(await accept(session, token, name), books.alice);
      const before = await rows(session, "select * from public.book_members where user_id = auth.uid()");
      assert.equal(await accept(session, token, "Retry must not rename me"), books.alice);
      assert.deepEqual(await rows(session, "select * from public.book_members where user_id = auth.uid()"), before);
      assert.equal(before.length, 1);
      assert.equal(before[0].user_id, subject);
      assert.equal(before[0].display_name, name);
      assert.equal(before[0].role, "member");
      assert.deepEqual(await visibleBooks(session), [{ id: books.alice, owner_id: users.alice }]);
      await rejected(() => session.query("select * from public.book_invitations"), "42501");
    });
  }
  const expected = [users.alice, users.chris, users.dana].map((user_id) => ({
    book_id: books.alice, user_id, role: user_id === users.alice ? "owner" : "member",
  }));
  await asUser(db, users.chris, async (session) => {
    assert.deepEqual(await visibleMembers(session), expected);
    const members = await rows(session, "select * from public.book_members");
    const bookRows = await rows(session, "select * from public.expense_books");
    assert.deepEqual(Object.keys(members[0]).sort(), ["book_id", "display_name", "id", "joined_at", "role", "user_id"]);
    assert.deepEqual(Object.keys(bookRows[0]).sort(), ["created_at", "currency_code", "currency_minor_digits", "default_split", "id", "name", "owner_id"]);
    assert.ok(!JSON.stringify([members, bookRows]).includes(token));
    assert.ok(!JSON.stringify([members, bookRows]).includes(hash(token)));
  });
  await asUser(db, users.alice, async (session) => {
    await accept(session, token, "Do not demote or rename owner");
    assert.deepEqual(await rows(session, "select role, display_name from public.book_members where book_id = $1 and user_id = auth.uid()", [books.alice]),
      [{ role: "owner", display_name: "Alice" }]);
  });
  await asUser(db, users.bob, async (session) => {
    assert.deepEqual(await visibleBooks(session), [{ id: books.bob, owner_id: users.bob }]);
    assert.equal((await visibleMembers(session)).length, 1);
  });
  assert.deepEqual(await rows(db, "select token_hash, created_by from public.book_invitations"),
    [{ token_hash: hash(token), created_by: users.alice }]);
  assert.equal(await scalar(db, "select count(*)::int from public.book_members where book_id = $1", [books.alice]), 3);
});

test("only owners rotate/revoke invitations; old/revoked tokens fail without removing members", async (t) => {
  const db = await fixture(t);
  await seedBook(db);
  await seedBook(db, users.bob, books.bob);
  await asUser(db, users.alice, (session) => invite(session, books.alice));
  await asUser(db, users.chris, (session) => accept(session));
  for (const subject of [users.chris, users.bob]) {
    await asUser(db, subject, async (session) => {
      await rejected(() => invite(session, books.alice, rotatedToken), "42501", "access_denied");
      await rejected(() => revoke(session, books.alice), "42501", "access_denied");
      await denyDirectWrites(session);
    });
  }
  assert.equal(await scalar(db, "select token_hash from public.book_invitations"), hash(token));
  await asUser(db, users.alice, (session) => invite(session, books.alice, rotatedToken));
  await asUser(db, users.dana, async (session) => {
    await rejected(() => accept(session, token, "Dana"), "22023", "invalid_invite");
    assert.deepEqual(await visibleBooks(session), []);
    assert.equal(await accept(session, rotatedToken, "Dana"), books.alice);
  });
  await asUser(db, users.alice, async (session) => {
    await revoke(session, books.alice);
    await revoke(session, books.alice); // Revocation itself is safe to retry.
  });
  await asUser(db, users.bob, async (session) => {
    await rejected(() => accept(session, rotatedToken, "Bob"), "22023", "invalid_invite");
    assert.deepEqual(await visibleBooks(session), [{ id: books.bob, owner_id: users.bob }]);
  });
  await asUser(db, users.chris, async (session) => {
    await rejected(() => accept(session, rotatedToken), "22023", "invalid_invite");
    assert.deepEqual(await visibleBooks(session), [{ id: books.alice, owner_id: users.alice }]);
    assert.equal((await visibleMembers(session)).length, 3);
  });
  assert.equal(await scalar(db, "select count(*)::int from public.book_invitations"), 0);
});

test("invites last seven days; same-token retries preserve expiry and expired/unknown tokens fail", async (t) => {
  const db = await fixture(t);
  await seedBook(db);
  const expiry = await asUser(db, users.alice, (session) => invite(session, books.alice));
  const original = await rows(db, "select * from public.book_invitations");
  assert.equal(new Date(expiry).getTime(), new Date(original[0].expires_at).getTime());
  assert.equal(await scalar(db, "select expires_at = created_at + interval '7 days' from public.book_invitations"), true);
  assert.deepEqual(await asUser(db, users.alice, (session) => invite(session, books.alice)), expiry);
  assert.deepEqual(await rows(db, "select * from public.book_invitations"), original);
  // Change only a local fixture timestamp; no sleeps, clock mocks, or SQL changes.
  await db.query("update public.book_invitations set expires_at = now() - interval '1 second' where book_id = $1", [books.alice]);
  const expired = await scalar(db, "select expires_at from public.book_invitations");
  assert.deepEqual(await asUser(db, users.alice, (session) => invite(session, books.alice)), expired);
  await asUser(db, users.chris, async (session) => {
    for (const value of [token, unknownToken]) {
      await rejected(() => accept(session, value), "22023", "invalid_invite");
    }
    assert.deepEqual(await visibleBooks(session), []);
    assert.deepEqual(await visibleMembers(session), []);
  });
  await asUser(db, users.alice, (session) => invite(session, books.alice, rotatedToken));
  await asUser(db, users.chris, async (session) => {
    assert.equal(await accept(session, rotatedToken), books.alice);
  });
});

test("currency and split selections persist, JPY has zero minor digits, and invalid inputs leave no rows", async (t) => {
  const db = await fixture(t);
  await asUser(db, users.alice, async (session) => {
    await createBook(session, books.alice, { name: "  Home  ", display: "  Alice  " });
    await createBook(session, books.other, { currency: "JPY", split: "personal" });
    await createBook(session, books.bob, { currency: "USD", split: "custom" });
    assert.deepEqual(await rows(session, "select currency_code, currency_minor_digits, default_split from public.expense_books order by id"), [
      { currency_code: "INR", currency_minor_digits: 2, default_split: "equal" },
      { currency_code: "JPY", currency_minor_digits: 0, default_split: "personal" },
      { currency_code: "USD", currency_minor_digits: 2, default_split: "custom" },
    ]);
    assert.equal(await scalar(session, "select name from public.expense_books where id = $1", [books.alice]), "Home");
    assert.equal(await scalar(session, "select display_name from public.book_members where book_id = $1", [books.alice]), "Alice");
    await rejected(() => createBook(session, null), "22023", "invalid_book");
    for (const invalid of [
      { name: null }, { name: "   " }, { name: "x".repeat(81) },
      { display: "" }, { display: "x".repeat(41) },
      { currency: null }, { currency: "ZZZ" }, { split: "unsupported" },
    ]) {
      await rejected(() => createBook(session, books.invalid, invalid), "22023", "invalid_book");
    }
    for (const invalidToken of [null, "a".repeat(63), "G".repeat(64)]) {
      await rejected(() => invite(session, books.alice, invalidToken), "22023", "invalid_invite");
      await rejected(() => accept(session, invalidToken), "22023", "invalid_invite");
    }
    await invite(session, books.alice);
  });
  await asUser(db, users.chris, async (session) => {
    for (const invalidName of [null, "  ", "x".repeat(41)]) {
      await rejected(() => accept(session, token, invalidName), "22023", "invalid_name");
    }
    assert.deepEqual(await visibleBooks(session), []);
    assert.deepEqual(await visibleMembers(session), []);
  });
  assert.equal(await scalar(db, "select count(*)::int from public.expense_books"), 3);
  assert.equal(await scalar(db, "select count(*)::int from public.book_members"), 3);
  assert.equal(await scalar(db, "select count(*)::int from public.book_invitations"), 1);
});
