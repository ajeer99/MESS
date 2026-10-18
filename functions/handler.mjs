// Partners Expenses business handler. Pure Web-standard APIs so the same file
// runs under Deno (deployed entry) and Node (local preview server).
// Authorization is application-level: a partner session token validated per request.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100000;
const MAX_BODY_CHARS = 16384;
const MAX_AMOUNT_PAISE = 100000000000; // ₹1 billion
const PAGE_SIZE = 500;
const SCAN_PAGE = 1000;
const MAX_SCAN_PAGES = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,29}$/;
const SPLIT_TYPES = ["equal", "personal", "percent"];
const SESSION_QP = "st";

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (code, status) => json({ ok: false, error: code }, status);

// ---------------------------------------------------------------- utilities

const encoder = new TextEncoder();

function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", encoder.encode(text));
}

// Deterministic UUID so recurring generation is idempotent by primary key.
async function deterministicUuid(text) {
  const digest = new Uint8Array(await sha256("pe:" + text));
  const hex = [...digest].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Human-friendly one-time invite code: 8 chars, no 0/O/1/I/L ambiguity.
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomInviteCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
}
const INVITE_CODE_RE = /^[A-Z2-9]{8}$/;
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Avatars: a whitelisted emoji, or a small client-resized photo as a data URL.
const AVATAR_EMOJI = ["🐱", "🐶", "🦊", "🐻", "🐼", "🦁", "🐨", "🐸", "🐵", "🐧", "🦄", "🌸", "🌟", "⚽", "🎮", "☕"];
const AVATAR_DATA_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR_URL_CHARS = 120000; // ~88 KB decoded; 128×128 webp lands far below
const MAX_AVATAR_BODY_CHARS = 132000;

async function hashPassword(password, saltB64) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(saltB64), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return bytesToB64(new Uint8Array(bits));
}

async function passwordRecord(password) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const salt = bytesToB64(bytes);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${await hashPassword(password, salt)}`;
}

async function verifyPassword(password, record) {
  const parts = typeof record === "string" ? record.split("$") : [];
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000000) return false;
  const actual = await hashPasswordWithIterations(password, parts[2], iterations);
  const expected = parts[3];
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function hashPasswordWithIterations(password, saltB64, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(saltB64), iterations },
    key,
    256,
  );
  return bytesToB64(new Uint8Array(bits));
}

function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function validDateString(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthKeyAdd(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthKeyBefore(dateStr) {
  return monthKeyAdd(dateStr.slice(0, 7), -1);
}

function clampMonth(key, day) {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, "0")}`;
}

function validText(value, maxLen) {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= maxLen &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validOptionalText(value, maxLen) {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length <= maxLen &&
    !/[\u0000-\u001f\u007f]/.test(value));
}

function validAmount(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_AMOUNT_PAISE;
}

// ---------------------------------------------------------------- body / session

async function readJsonBody(request, maxChars = MAX_BODY_CHARS) {
  let text;
  try {
    text = await request.text();
  } catch {
    return { error: "invalid_input" };
  }
  if (text.length > maxChars) return { error: "body_too_large" };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "invalid_input" };
    return { data };
  } catch {
    return { error: "invalid_input" };
  }
}

function sessionTokenOf(request, params) {
  const fromQuery = params.get(SESSION_QP);
  if (typeof fromQuery === "string" && /^[0-9a-f]{64}$/.test(fromQuery)) return fromQuery;
  const fromHeader = request.headers.get("x-pe-session");
  if (typeof fromHeader === "string" && /^[0-9a-f]{64}$/.test(fromHeader)) return fromHeader;
  return null;
}

async function requirePartner(request, supabase, params) {
  const token = sessionTokenOf(request, params);
  if (!token) return null;
  const nowIso = new Date().toISOString();
  const sess = await supabase.from("sessions").select("token,partner_id,expires_at").eq("token", token).maybeSingle();
  if (sess.error || !sess.data) return null;
  if (typeof sess.data.expires_at !== "string" || sess.data.expires_at <= nowIso) {
    await supabase.from("sessions").delete().eq("token", token).select("token");
    return null;
  }
  const p = await supabase.from("partners")
    .select("id,slot,name,username,created_at").eq("id", sess.data.partner_id).maybeSingle();
  if (p.error || !p.data) return null;
  const { slot, ...rest } = p.data;
  return { partner: { ...rest, position: slot }, token };
}

async function loadPartners(supabase) {
  const res = await supabase.from("partners")
    .select("id,slot,name,username,avatar_emoji,avatar_url").order("slot", { ascending: true }).limit(50);
  if (res.error || !Array.isArray(res.data) || res.data.length < 1) return null;
  // DB column is `slot` (the platform DDL validator rejects the SQL keyword `position`);
  // the API keeps exposing it as `position`. Avatar columns are NOT NULL: "" means "not set".
  return res.data.map(({ slot, ...rest }) => (
    { ...rest, position: slot, avatar_emoji: rest.avatar_emoji || null, avatar_url: rest.avatar_url || null }
  ));
}

// At most one invite row exists at a time. A null partner_id = self-signup invite;
// a set partner_id = one-tap joining link for a partner the owner added manually.
async function loadInvite(supabase) {
  const res = await supabase.from("invites").select("code,partner_id").limit(1).maybeSingle();
  if (res.error) return null;
  if (!res.data || typeof res.data.code !== "string") return null;
  return {
    code: res.data.code,
    partnerId: typeof res.data.partner_id === "string" ? res.data.partner_id : null,
  };
}

async function closedMonths(supabase) {
  const res = await supabase.from("month_closes").select("month").limit(240);
  if (res.error || !Array.isArray(res.data)) return null;
  return new Set(res.data.map((r) => r.month));
}

// Best-effort per-isolate login throttle; raises brute-force cost without claiming protection.
const loginFailures = new Map();
function loginLocked(username) {
  const f = loginFailures.get(username);
  return !!f && f.until > Date.now();
}
function recordLoginFailure(username) {
  const f = loginFailures.get(username) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= 5) {
    f.until = Date.now() + 60000;
    f.count = 0;
  }
  loginFailures.set(username, f);
}

// ---------------------------------------------------------------- shares & recurring

/** Compute shares Record<partnerId, paise> for an expense.
 * splitType "personal" => only payer bears the cost.
 * splitType "equal"   => split equally among splitPartners (remainder to payer).
 * splitType "custom"  => use customShares directly after validation.
 */
function computeShares(amountPaise, splitType, paidBy, splitPartners, customShares) {
  if (splitType === "personal") return { [paidBy]: amountPaise };
  if (splitType === "custom") {
    // customShares should already sum to amountPaise
    return customShares;
  }
  // equal split among splitPartners
  const included = splitPartners.filter((id) => id !== paidBy);
  const n = included.length + 1; // include payer
  const base = Math.floor(amountPaise / n);
  const rem = amountPaise - base * n;
  const result = {};
  for (const id of included) result[id] = base;
  result[paidBy] = base + rem; // payer absorbs remainder
  return result;
}

const SPLIT_TYPES_N = ["equal", "personal", "custom"];

function validateExpenseInput(body, partners) {
  const partnerIds = new Set(partners.map((p) => p.id));
  const date = body.date;
  if (!validDateString(date)) return { error: "invalid_date" };
  const merchant = typeof body.merchant === "string" ? body.merchant.trim() : "";
  if (!validText(merchant, 80)) return { error: "invalid_merchant" };
  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (!validText(category, 40)) return { error: "invalid_category" };
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!validOptionalText(note, 200)) return { error: "invalid_note" };
  const amountPaise = body.amountPaise;
  if (!validAmount(amountPaise)) return { error: "invalid_amount" };
  const paidBy = body.paidBy;
  if (typeof paidBy !== "string" || !UUID_RE.test(paidBy) || !partnerIds.has(paidBy)) return { error: "invalid_payer" };
  const splitType = body.splitType;
  if (typeof splitType !== "string" || !SPLIT_TYPES_N.includes(splitType)) return { error: "invalid_split" };
  let splitPartners = [];
  let customShares;
  if (splitType === "equal") {
    const raw = Array.isArray(body.splitPartners) ? body.splitPartners : [...partnerIds];
    splitPartners = raw.filter((id) => typeof id === "string" && partnerIds.has(id));
    if (splitPartners.length < 1 || !splitPartners.includes(paidBy)) return { error: "invalid_split" };
  } else if (splitType === "custom") {
    if (!body.customShares || typeof body.customShares !== "object") return { error: "invalid_split" };
    let total = 0;
    customShares = {};
    for (const [pid, amt] of Object.entries(body.customShares)) {
      if (!partnerIds.has(pid)) return { error: "invalid_payer" };
      if (!Number.isSafeInteger(amt) || amt < 0) return { error: "invalid_amount" };
      customShares[pid] = amt;
      total += amt;
    }
    if (total !== amountPaise) return { error: "invalid_amount" };
  }
  return { input: { date, merchant, category, note, amountPaise, paidBy, splitType, splitPartners, customShares } };
}

// Generates any due recurring expenses. Deterministic ids make re-runs idempotent.
async function runRecurring(supabase, partners) {
  const partnerIds = new Set(partners.map((p) => p.id));
  const closed = await closedMonths(supabase);
  if (!closed) return false;
  const res = await supabase.from("recurring_rules")
    .select("*").eq("active", true).order("created_at", { ascending: true }).limit(100);
  if (res.error || !Array.isArray(res.data)) return false;
  const today = todayIST();
  const currentMonth = today.slice(0, 7);
  const nowIso = new Date().toISOString();
  for (const rule of res.data) {
    const day = Number(rule.day_of_month);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    if (!validAmount(Number(rule.amount_paise))) continue;
    let splitPartners;
    try { splitPartners = JSON.parse(rule.split_partners ?? "null"); } catch { splitPartners = null; }
    if (!Array.isArray(splitPartners)) splitPartners = partners.map((p) => p.id);
    splitPartners = splitPartners.filter((id) => partnerIds.has(id));
    if (!splitPartners.includes(rule.paid_by)) splitPartners.push(rule.paid_by);
    let last = typeof rule.last_generated === "string" && /^\d{4}-\d{2}$/.test(rule.last_generated)
      ? rule.last_generated
      : monthKeyBefore(currentMonth);
    let generated = false;
    for (let i = 0; i < 60; i++) {
      const month = monthKeyAdd(last, 1);
      if (month > currentMonth) break;
      // Closed months are final — never generate into them, just advance past.
      if (closed.has(month)) { last = month; generated = true; continue; }
      const targetDate = clampMonth(month, day);
      if (targetDate > today) break;
      const shares = computeShares(Number(rule.amount_paise), rule.split_type, rule.paid_by, splitPartners, undefined);
      const id = await deterministicUuid(`${rule.id}:${month}`);
      const ins = await supabase.from("expenses").insert({
        id,
        expense_date: targetDate,
        merchant: rule.merchant,
        category: rule.category,
        note: rule.note ?? "",
        amount_paise: Number(rule.amount_paise),
        paid_by: rule.paid_by,
        split_type: rule.split_type,
        shares: JSON.stringify(shares),
        recurring_rule_id: rule.id,
        created_by: rule.created_by,
        created_at: nowIso,
      }).select("id").single();
      if (ins.error) {
        if (ins.error.code === "23505") { /* already generated */ }
        else return false;
      }
      last = month;
      generated = true;
    }
    if (generated) {
      const upd = await supabase.from("recurring_rules").update({ last_generated: last }).eq("id", rule.id).select("id").maybeSingle();
      if (upd.error) return false;
    }
  }
  return true;
}

// Authoritative pairwise balance over full history.
// Returns net[i][j] = how much partner i has paid on behalf of partner j (net of settlements).
async function computeBalanceAndLists(supabase, partners) {
  const partnerIds = partners.map((p) => p.id);
  const idx = new Map(partnerIds.map((id, i) => [id, i]));
  const n = partnerIds.length;
  // net[i][j] > 0 means partner i is owed net[i][j] paise by partner j
  const net = Array.from({ length: n }, () => new Array(n).fill(0));
  const merchantCounts = new Map();
  const categoryCounts = new Map();
  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const res = await supabase.from("expenses")
      .select("paid_by,amount_paise,shares,merchant,category")
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(page * SCAN_PAGE, (page + 1) * SCAN_PAGE - 1);
    if (res.error || !Array.isArray(res.data)) return null;
    for (const row of res.data) {
      const payerIdx = idx.get(row.paid_by);
      if (payerIdx === undefined) continue;
      let shares = {};
      try { shares = JSON.parse(row.shares ?? "{}"); } catch { /* skip */ }
      for (const [pid, share] of Object.entries(shares)) {
        const pIdx = idx.get(pid);
        if (pIdx === undefined || pIdx === payerIdx) continue;
        const amt = Number(share) || 0;
        net[payerIdx][pIdx] += amt; // payer is owed this by pid
      }
      if (typeof row.merchant === "string" && merchantCounts.size < 500) {
        merchantCounts.set(row.merchant, (merchantCounts.get(row.merchant) ?? 0) + 1);
      }
      if (typeof row.category === "string" && categoryCounts.size < 100) {
        categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + 1);
      }
    }
    if (res.data.length < SCAN_PAGE) break;
  }
  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const res = await supabase.from("settlements")
      .select("from_partner,to_partner,amount_paise")
      .range(page * SCAN_PAGE, (page + 1) * SCAN_PAGE - 1);
    if (res.error || !Array.isArray(res.data)) return null;
    for (const row of res.data) {
      const fIdx = idx.get(row.from_partner);
      const tIdx = idx.get(row.to_partner);
      if (fIdx === undefined || tIdx === undefined) continue;
      const amt = Number(row.amount_paise) || 0;
      // from paid to, reducing what from owes to
      net[tIdx][fIdx] -= amt;
    }
    if (res.data.length < SCAN_PAGE) break;
  }
  // Simplify: net[i][j] and net[j][i] -> single direction
  const debts = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = net[i][j] - net[j][i]; // > 0 means j owes i
      if (diff > 0) {
        debts.push({ fromId: partnerIds[j], fromName: partners[j].name, toId: partnerIds[i], toName: partners[i].name, amountPaise: diff });
      } else if (diff < 0) {
        debts.push({ fromId: partnerIds[i], fromName: partners[i].name, toId: partnerIds[j], toName: partners[j].name, amountPaise: -diff });
      }
    }
  }
  return {
    debts,
    lists: {
      merchants: [...merchantCounts.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count),
      categories: [...categoryCounts.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count),
    },
  };
}

// balancePayload removed — debts array is returned directly from computeBalanceAndLists

// ---------------------------------------------------------------- actions

async function actBootstrap(request, supabase) {
  if (request.method !== "GET") return fail("method_not_allowed", 405);
  const res = await supabase.from("partners").select("id", { count: "exact" }).limit(1);
  if (res.error || !Number.isSafeInteger(res.count) || res.count < 0) return fail("database_request_failed", 503);
  return json({ ok: true, setupRequired: res.count < 1 });
}

async function actSetup(request, supabase) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const d = body.data;
  const name = typeof d.name === "string" ? d.name.trim() : "";
  const username = typeof d.username === "string" ? d.username.trim().toLowerCase() : "";
  const password = typeof d.password === "string" ? d.password : "";
  if (!validText(name, 40)) return fail("invalid_name", 400);
  if (!USERNAME_RE.test(username)) return fail("invalid_username", 400);
  if (password.length < 6 || password.length > 128) return fail("invalid_password", 400);
  const count = await supabase.from("partners").select("id", { count: "exact" }).limit(1);
  if (count.error || !Number.isSafeInteger(count.count)) return fail("database_request_failed", 503);
  if (count.count >= 1) return fail("already_set_up", 409);
  const nowIso = new Date().toISOString();
  const ins = await supabase.from("partners").insert([
    { id: crypto.randomUUID(), slot: 0, name, username, password_hash: await passwordRecord(password), avatar_emoji: "", avatar_url: "", created_at: nowIso },
  ]).select("id");
  if (ins.error || !Array.isArray(ins.data) || ins.data.length !== 1) return fail("setup_failed", 503);
  const invite = await supabase.from("invites").insert({
    code: randomInviteCode(), created_by: ins.data[0].id, partner_id: null, created_at: nowIso,
  }).select("code").single();
  if (invite.error) { /* invite is convenience, not fatal */ }
  return json({ ok: true });
}

async function actAcceptInvite(request, supabase) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const d = body.data;
  const code = typeof d.code === "string" ? d.code.trim().toUpperCase() : "";
  const name = typeof d.name === "string" ? d.name.trim() : "";
  const username = typeof d.username === "string" ? d.username.trim().toLowerCase() : "";
  const password = typeof d.password === "string" ? d.password : "";
  if (!INVITE_CODE_RE.test(code)) return fail("invalid_invite", 404);
  if (!validText(name, 40)) return fail("invalid_name", 400);
  if (!USERNAME_RE.test(username)) return fail("invalid_username", 400);
  if (password.length < 6 || password.length > 128) return fail("invalid_password", 400);
  const invite = await supabase.from("invites").select("code,partner_id").eq("code", code).maybeSingle();
  if (invite.error) return fail("database_request_failed", 503);
  if (!invite.data) return fail("invalid_invite", 404);
  if (typeof invite.data.partner_id === "string") return fail("join_link", 404); // one-tap joining link, not a signup invite
  const existing = await supabase.from("partners").select("username").eq("username", username).maybeSingle();
  if (existing.error) return fail("database_request_failed", 503);
  if (existing.data) return fail("invalid_username", 409);
  const countRes = await supabase.from("partners").select("id", { count: "exact" }).limit(1);
  if (countRes.error || !Number.isSafeInteger(countRes.count)) return fail("database_request_failed", 503);
  if (countRes.count >= 2) return fail("already_two_partners", 409);
  const top = await supabase.from("partners").select("slot").order("slot", { ascending: false }).limit(1).maybeSingle();
  if (top.error) return fail("database_request_failed", 503);
  const nextPos = top.data ? Number(top.data.slot) + 1 : 1;
  const nowIso = new Date().toISOString();
  const ins = await supabase.from("partners").insert([
    { id: crypto.randomUUID(), slot: nextPos, name, username, password_hash: await passwordRecord(password), avatar_emoji: "", avatar_url: "", created_at: nowIso },
  ]).select("id,slot,name,username").single();
  if (ins.error || !ins.data) return fail("setup_failed", 503);
  // One-time use: consume the code so the link dies after acceptance.
  const consumed = await supabase.from("invites").delete().eq("code", code).select("code");
  if (consumed.error) { /* best-effort */ }
  const { slot, ...partnerRest } = ins.data;
  return json({ ok: true, partner: { ...partnerRest, position: slot } });
}

async function actJoin(request, supabase) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const code = typeof body.data.code === "string" ? body.data.code.trim().toUpperCase() : "";
  if (!INVITE_CODE_RE.test(code)) return fail("invalid_join", 404);
  const row = await supabase.from("invites").select("code,partner_id").eq("code", code).maybeSingle();
  if (row.error) return fail("database_request_failed", 503);
  if (!row.data || typeof row.data.partner_id !== "string") return fail("invalid_join", 404); // signup codes don't sign anyone in directly
  const partner = await supabase.from("partners")
    .select("id,slot,name,username").eq("id", row.data.partner_id).maybeSingle();
  if (partner.error) return fail("database_request_failed", 503);
  if (!partner.data) return fail("invalid_join", 404);
  const token = await createSession(supabase, partner.data.id);
  if (!token) return fail("database_request_failed", 503);
  // One-time use: the link dies the moment it signs someone in.
  const consumed = await supabase.from("invites").delete().eq("code", code).select("code");
  if (consumed.error) { /* best-effort */ }
  const { slot, ...joined } = partner.data;
  return json({ ok: true, token, partner: { ...joined, position: slot } });
}

async function actRegenerateInvite(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  // Rotate in place, keeping the kind: signup invite stays signup, joining link stays with its partner.
  const existing = await supabase.from("invites").select("code,partner_id").limit(1).maybeSingle();
  if (existing.error) return fail("database_request_failed", 503);
  const partnerId = typeof existing.data?.partner_id === "string" ? existing.data.partner_id : null;
  await supabase.from("invites").delete().neq("code", "").select("code");
  const ins = await supabase.from("invites").insert({
    code: randomInviteCode(), created_by: auth.partner.id, partner_id: partnerId, created_at: new Date().toISOString(),
  }).select("code").single();
  if (ins.error || !ins.data) return fail("write_rejected", 503);
  return json({ ok: true, inviteCode: ins.data.code, invitePartnerId: partnerId });
}

// ---------------------------------------------------------------- month closing

function lastDayOfMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

// Snapshot of the month's activity, stored with the close record for audit.
async function buildMonthSummary(supabase, partners, month) {
  const from = `${month}-01`;
  const to = lastDayOfMonthKey(month);
  const expenses = await supabase.from("expenses")
    .select("paid_by,amount_paise,shares,category")
    .gte("expense_date", from).lte("expense_date", to)
    .limit(10000);
  if (expenses.error || !Array.isArray(expenses.data)) return null;
  const settlements = await supabase.from("settlements")
    .select("amount_paise")
    .gte("settle_date", from).lte("settle_date", to)
    .limit(1000);
  if (settlements.error || !Array.isArray(settlements.data)) return null;
  const aggregates = await computeBalanceAndLists(supabase, partners);
  if (!aggregates) return null;
  const paidBy = {};
  const sharesBy = {};
  const byCategory = new Map();
  let totalPaise = 0;
  for (const row of expenses.data) {
    const amt = Number(row.amount_paise) || 0;
    totalPaise += amt;
    paidBy[row.paid_by] = (paidBy[row.paid_by] ?? 0) + amt;
    let shares = {};
    try { shares = JSON.parse(row.shares ?? "{}"); } catch { /* ignore */ }
    for (const [pid, share] of Object.entries(shares)) {
      sharesBy[pid] = (sharesBy[pid] ?? 0) + (Number(share) || 0);
    }
    const cat = typeof row.category === "string" ? row.category : "Other";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + amt);
  }
  let settledPaise = 0;
  for (const row of settlements.data) settledPaise += Number(row.amount_paise) || 0;
  return {
    totalPaise,
    expenseCount: expenses.data.length,
    paidBy,
    sharesBy,
    byCategory: [...byCategory.entries()].map(([name, paise]) => ({ name, paise })).sort((a, b) => b.paise - a.paise),
    settlements: { count: settlements.data.length, totalPaise: settledPaise },
    debts: aggregates.debts,
  };
}

async function actCloseMonth(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const partners = await loadPartners(supabase);
  if (!partners) return fail("not_found", 404);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const month = typeof body.data.month === "string" ? body.data.month : "";
  if (!MONTH_KEY_RE.test(month)) return fail("invalid_input", 400);
  const currentMonth = todayIST().slice(0, 7);
  if (month >= currentMonth) return fail("invalid_input", 400); // only past months
  const existing = await supabase.from("month_closes").select("month").eq("month", month).maybeSingle();
  if (existing.error) return fail("database_request_failed", 503);
  if (existing.data) return fail("already_closed", 409);
  const summary = await buildMonthSummary(supabase, partners, month);
  if (!summary) return fail("database_request_failed", 503);
  const ins = await supabase.from("month_closes").insert({
    month,
    closed_by: auth.partner.id,
    closed_at: new Date().toISOString(),
    summary: JSON.stringify(summary),
  }).select("month").single();
  if (ins.error || !ins.data) return fail("write_rejected", 503);
  return json({ ok: true, month, summary });
}

async function actReopenMonth(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const month = typeof body.data.month === "string" ? body.data.month : "";
  if (!MONTH_KEY_RE.test(month)) return fail("invalid_input", 400);
  const del = await supabase.from("month_closes").delete().eq("month", month).select("month").maybeSingle();
  if (del.error) return fail("write_rejected", 503);
  if (!del.data) return fail("not_closed", 404);
  return json({ ok: true, month });
}

async function actAddPartner(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const d = body.data;
  const name = typeof d.name === "string" ? d.name.trim() : "";
  const username = typeof d.username === "string" ? d.username.trim().toLowerCase() : "";
  const password = typeof d.password === "string" ? d.password : "";
  if (!validText(name, 40)) return fail("invalid_name", 400);
  if (!USERNAME_RE.test(username)) return fail("invalid_username", 400);
  if (password.length < 6 || password.length > 128) return fail("invalid_password", 400);
  const existing = await supabase.from("partners").select("username").eq("username", username).maybeSingle();
  if (existing.error) return fail("database_request_failed", 503);
  if (existing.data) return fail("invalid_username", 409);
  const countRes = await supabase.from("partners").select("id", { count: "exact" }).limit(1);
  if (countRes.error || !Number.isSafeInteger(countRes.count)) return fail("database_request_failed", 503);
  if (countRes.count >= 2) return fail("already_two_partners", 409);
  const top = await supabase.from("partners").select("slot").order("slot", { ascending: false }).limit(1).maybeSingle();
  if (top.error) return fail("database_request_failed", 503);
  const nextPos = top.data ? Number(top.data.slot) + 1 : 1;
  const nowIso = new Date().toISOString();
  const ins = await supabase.from("partners").insert([
    { id: crypto.randomUUID(), slot: nextPos, name, username, password_hash: await passwordRecord(password), avatar_emoji: "", avatar_url: "", created_at: nowIso },
  ]).select("id,slot,name,username").single();
  if (ins.error || !ins.data) return fail("setup_failed", 503);
  // Replace any pending invite with a one-tap joining link for the new partner.
  await supabase.from("invites").delete().neq("code", "").select("code");
  const invite = await supabase.from("invites").insert({
    code: randomInviteCode(), created_by: auth.partner.id, partner_id: ins.data.id, created_at: nowIso,
  }).select("code").single();
  if (invite.error) { /* partner exists; the link can be re-issued from More */ }
  const { slot, ...partnerRest } = ins.data;
  return json({ ok: true, partner: { ...partnerRest, position: slot }, inviteCode: invite.data?.code ?? null });
}

// Issues a fresh session token; returns null when the write fails.
async function createSession(supabase, partnerId) {
  const now = Date.now();
  const token = randomToken();
  const ins = await supabase.from("sessions").insert({
    token,
    partner_id: partnerId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
  }).select("token").single();
  if (ins.error) return null;
  const expired = await supabase.from("sessions").delete().lt("expires_at", new Date(now).toISOString()).select("token");
  if (expired.error) { /* best-effort cleanup */ }
  return token;
}

async function actLogin(request, supabase) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const d = body.data;
  const username = typeof d.username === "string" ? d.username.trim().toLowerCase() : "";
  const password = typeof d.password === "string" ? d.password : "";
  if (!USERNAME_RE.test(username) || password.length < 1 || password.length > 128) return fail("invalid_input", 400);
  if (loginLocked(username)) return fail("login_locked", 429);
  const res = await supabase.from("partners").select("id,slot,name,username,password_hash").eq("username", username).maybeSingle();
  if (res.error) return fail("database_request_failed", 503);
  const partner = res.data;
  if (!partner || !(await verifyPassword(password, partner.password_hash))) {
    recordLoginFailure(username);
    return fail("invalid_credentials", 401);
  }
  const token = await createSession(supabase, partner.id);
  if (!token) return fail("database_request_failed", 503);
  loginFailures.delete(username);
  return json({
    ok: true,
    token,
    partner: { id: partner.id, position: partner.slot, name: partner.name, username: partner.username },
  });
}

async function actLogout(request, supabase, params) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const token = sessionTokenOf(request, params);
  if (token) {
    await supabase.from("sessions").delete().eq("token", token).select("token");
  }
  return json({ ok: true });
}

async function actData(request, supabase, params, auth) {
  if (request.method !== "GET") return fail("method_not_allowed", 405);
  const partners = await loadPartners(supabase);
  if (!partners) return fail("not_found", 404);
  const today = todayIST();
  const from = params.get("from") ?? monthKeyAdd(today.slice(0, 7), -12) + "-01";
  const to = params.get("to") ?? today;
  if (!validDateString(from) || !validDateString(to) || from > to) return fail("invalid_input", 400);
  if (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`) > 750 * 86400000) return fail("range_too_wide", 400);
  const rawOffset = params.get("offset") ?? "0";
  if (!/^(0|[1-9][0-9]{0,5})$/.test(rawOffset)) return fail("invalid_offset", 400);
  const offset = Number(rawOffset);
  const expenses = await supabase.from("expenses")
    .select("*")
    .gte("expense_date", from).lte("expense_date", to)
    .order("expense_date", { ascending: false }).order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE);
  if (expenses.error || !Array.isArray(expenses.data)) return fail("database_request_failed", 503);
  const hasMore = expenses.data.length > PAGE_SIZE;
  const settlements = await supabase.from("settlements")
    .select("*")
    .gte("settle_date", from).lte("settle_date", to)
    .order("settle_date", { ascending: false })
    .limit(PAGE_SIZE);
  if (settlements.error || !Array.isArray(settlements.data)) return fail("database_request_failed", 503);
  const rules = await supabase.from("recurring_rules").select("*").order("created_at", { ascending: true }).limit(100);
  if (rules.error || !Array.isArray(rules.data)) return fail("database_request_failed", 503);
  const aggregates = await computeBalanceAndLists(supabase, partners);
  if (!aggregates) return fail("database_request_failed", 503);
  const invite = await loadInvite(supabase);
  const closesRes = await supabase.from("month_closes").select("*").order("month", { ascending: false }).limit(240);
  if (closesRes.error || !Array.isArray(closesRes.data)) return fail("database_request_failed", 503);
  return json({
    ok: true,
    partners,
    range: { from, to },
    expenses: expenses.data.slice(0, PAGE_SIZE),
    hasMore,
    nextOffset: hasMore ? offset + PAGE_SIZE : null,
    settlements: settlements.data,
    recurring: rules.data,
    debts: aggregates.debts,
    lists: aggregates.lists,
    inviteCode: invite?.code ?? null,
    invitePartnerId: invite?.partnerId ?? null,
    monthCloses: closesRes.data.map((r) => {
      let summary = null;
      try { summary = JSON.parse(r.summary ?? "null"); } catch { /* leave null */ }
      return { month: r.month, closedBy: r.closed_by, closedAt: r.closed_at, summary };
    }),
  });
}

async function actSync(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const partners = await loadPartners(supabase);
  if (!partners) return fail("not_found", 404);
  const ok = await runRecurring(supabase, partners);
  if (!ok) return fail("database_request_failed", 503);
  return json({ ok: true });
}

async function actAddExpense(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const partners = await loadPartners(supabase);
  if (!partners) return fail("not_found", 404);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const checked = validateExpenseInput(body.data, partners);
  if (checked.error) return fail(checked.error, 400);
  const closed = await closedMonths(supabase);
  if (!closed) return fail("database_request_failed", 503);
  if (closed.has(checked.input.date.slice(0, 7))) return fail("month_closed", 409);
  const shares = computeShares(checked.input.amountPaise, checked.input.splitType, checked.input.paidBy, checked.input.splitPartners, checked.input.customShares);
  const ins = await supabase.from("expenses").insert({
    id: crypto.randomUUID(),
    expense_date: checked.input.date,
    merchant: checked.input.merchant,
    category: checked.input.category,
    note: checked.input.note,
    amount_paise: checked.input.amountPaise,
    paid_by: checked.input.paidBy,
    split_type: checked.input.splitType,
    shares: JSON.stringify(shares),
    recurring_rule_id: null,
    created_by: auth.partner.id,
    created_at: new Date().toISOString(),
  }).select("*").single();
  if (ins.error || !ins.data) return fail("write_rejected", 503);
  return json({ ok: true, expense: ins.data });
}

async function actUpdateExpense(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const partners = await loadPartners(supabase);
  if (!partners) return fail("not_found", 404);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const id = body.data.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return fail("invalid_input", 400);
  const existing = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();
  if (existing.error) return fail("database_request_failed", 503);
  if (!existing.data) return fail("not_found", 404);
  const checked = validateExpenseInput(body.data, partners);
  if (checked.error) return fail(checked.error, 400);
  const closed = await closedMonths(supabase);
  if (!closed) return fail("database_request_failed", 503);
  // Locked both ways: cannot touch an expense inside a closed month, nor move one into it.
  if (closed.has(existing.data.expense_date.slice(0, 7)) ||
    closed.has(checked.input.date.slice(0, 7))) return fail("month_closed", 409);
  const shares = computeShares(checked.input.amountPaise, checked.input.splitType, checked.input.paidBy, checked.input.splitPartners, checked.input.customShares);
  const upd = await supabase.from("expenses").update({
    expense_date: checked.input.date,
    merchant: checked.input.merchant,
    category: checked.input.category,
    note: checked.input.note,
    amount_paise: checked.input.amountPaise,
    paid_by: checked.input.paidBy,
    split_type: checked.input.splitType,
    shares: JSON.stringify(shares),
  }).eq("id", id).select("*").maybeSingle();
  if (upd.error) return fail("write_rejected", 503);
  if (!upd.data) return fail("not_found", 404);
  return json({ ok: true, expense: upd.data });
}

async function actDeleteExpense(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const id = body.data.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return fail("invalid_input", 400);
  const existing = await supabase.from("expenses").select("id,expense_date").eq("id", id).maybeSingle();
  if (existing.error) return fail("database_request_failed", 503);
  if (!existing.data) return fail("not_found", 404);
  const closed = await closedMonths(supabase);
  if (!closed) return fail("database_request_failed", 503);
  if (closed.has(existing.data.expense_date.slice(0, 7))) return fail("month_closed", 409);
  const del = await supabase.from("expenses").delete().eq("id", id).select("id").maybeSingle();
  if (del.error) return fail("write_rejected", 503);
  if (!del.data) return fail("not_found", 404);
  return json({ ok: true });
}

async function actAddSettlement(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const partners = await loadPartners(supabase);
  if (!partners) return fail("not_found", 404);
  const partnerIds = new Set(partners.map((p) => p.id));
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const d = body.data;
  if (!validDateString(d.date)) return fail("invalid_date", 400);
  const note = typeof d.note === "string" ? d.note.trim() : "";
  if (!validOptionalText(note, 200)) return fail("invalid_note", 400);
  const amountPaise = d.amountPaise;
  if (!validAmount(amountPaise)) return fail("invalid_amount", 400);
  const fromId = d.fromId;
  const toId = d.toId;
  if (typeof fromId !== "string" || typeof toId !== "string" || !UUID_RE.test(fromId) || !UUID_RE.test(toId) ||
    fromId === toId || !partnerIds.has(fromId) || !partnerIds.has(toId)) return fail("invalid_input", 400);
  const closed = await closedMonths(supabase);
  if (!closed) return fail("database_request_failed", 503);
  if (closed.has(d.date.slice(0, 7))) return fail("month_closed", 409);
  const ins = await supabase.from("settlements").insert({
    id: crypto.randomUUID(),
    settle_date: d.date,
    from_partner: fromId,
    to_partner: toId,
    amount_paise: amountPaise,
    note,
    created_by: auth.partner.id,
    created_at: new Date().toISOString(),
  }).select("*").single();
  if (ins.error || !ins.data) return fail("write_rejected", 503);
  return json({ ok: true, settlement: ins.data });
}

async function actDeleteSettlement(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const id = body.data.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return fail("invalid_input", 400);
  const existing = await supabase.from("settlements").select("id,settle_date").eq("id", id).maybeSingle();
  if (existing.error) return fail("database_request_failed", 503);
  if (!existing.data) return fail("not_found", 404);
  const closed = await closedMonths(supabase);
  if (!closed) return fail("database_request_failed", 503);
  if (closed.has(existing.data.settle_date.slice(0, 7))) return fail("month_closed", 409);
  const del = await supabase.from("settlements").delete().eq("id", id).select("id").maybeSingle();
  if (del.error) return fail("write_rejected", 503);
  if (!del.data) return fail("not_found", 404);
  return json({ ok: true });
}

function validateRecurringInput(d, partners) {
  const partnerIds = new Set(partners.map((p) => p.id));
  const merchant = typeof d.merchant === "string" ? d.merchant.trim() : "";
  if (!validText(merchant, 80)) return { error: "invalid_merchant" };
  const category = typeof d.category === "string" ? d.category.trim() : "";
  if (!validText(category, 40)) return { error: "invalid_category" };
  const note = typeof d.note === "string" ? d.note.trim() : "";
  if (!validOptionalText(note, 200)) return { error: "invalid_note" };
  const amountPaise = d.amountPaise;
  if (!validAmount(amountPaise)) return { error: "invalid_amount" };
  const paidBy = d.paidBy;
  if (typeof paidBy !== "string" || !UUID_RE.test(paidBy) || !partnerIds.has(paidBy)) return { error: "invalid_payer" };
  const splitType = d.splitType;
  if (typeof splitType !== "string" || !SPLIT_TYPES_N.includes(splitType)) return { error: "invalid_split" };
  const raw = Array.isArray(d.splitPartners) ? d.splitPartners : [...partnerIds];
  const splitPartners = raw.filter((id) => typeof id === "string" && partnerIds.has(id));
  if (splitPartners.length < 1 || (splitType === "equal" && !splitPartners.includes(paidBy))) return { error: "invalid_split" };
  const dayOfMonth = d.dayOfMonth;
  if (!Number.isSafeInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return { error: "invalid_day" };
  const active = d.active;
  if (typeof active !== "boolean") return { error: "invalid_input" };
  return { input: { merchant, category, note, amountPaise, paidBy, splitType, splitPartners, dayOfMonth, active } };
}

async function actAddRecurring(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const partners = await loadPartners(supabase);
  if (!partners) return fail("not_found", 404);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const checked = validateRecurringInput(body.data, partners);
  if (checked.error) return fail(checked.error, 400);
  const today = todayIST();
  const ins = await supabase.from("recurring_rules").insert({
    id: crypto.randomUUID(),
    merchant: checked.input.merchant,
    category: checked.input.category,
    note: checked.input.note,
    amount_paise: checked.input.amountPaise,
    paid_by: checked.input.paidBy,
    split_type: checked.input.splitType,
    split_partners: JSON.stringify(checked.input.splitPartners),
    day_of_month: checked.input.dayOfMonth,
    active: checked.input.active,
    last_generated: monthKeyBefore(today.slice(0, 7)),
    created_by: auth.partner.id,
    created_at: new Date().toISOString(),
  }).select("*").single();
  if (ins.error || !ins.data) return fail("write_rejected", 503);
  await runRecurring(supabase, partners);
  return json({ ok: true, rule: ins.data });
}

async function actUpdateRecurring(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const partners = await loadPartners(supabase);
  if (!partners) return fail("not_found", 404);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const d = body.data;
  const id = d.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return fail("invalid_input", 400);
  const existing = await supabase.from("recurring_rules").select("*").eq("id", id).maybeSingle();
  if (existing.error) return fail("database_request_failed", 503);
  if (!existing.data) return fail("not_found", 404);
  const checked = validateRecurringInput(d, partners);
  if (checked.error) return fail(checked.error, 400);
  const lastGenerated = existing.data.active ? existing.data.last_generated : monthKeyBefore(todayIST().slice(0, 7));
  const upd = await supabase.from("recurring_rules").update({
    merchant: checked.input.merchant,
    category: checked.input.category,
    note: checked.input.note,
    amount_paise: checked.input.amountPaise,
    paid_by: checked.input.paidBy,
    split_type: checked.input.splitType,
    split_partners: JSON.stringify(checked.input.splitPartners),
    day_of_month: checked.input.dayOfMonth,
    active: checked.input.active,
    last_generated: lastGenerated,
  }).eq("id", id).select("*").maybeSingle();
  if (upd.error) return fail("write_rejected", 503);
  if (!upd.data) return fail("not_found", 404);
  await runRecurring(supabase, partners);
  return json({ ok: true, rule: upd.data });
}

async function actDeleteRecurring(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const id = body.data.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return fail("invalid_input", 400);
  const del = await supabase.from("recurring_rules").delete().eq("id", id).select("id").maybeSingle();
  if (del.error) return fail("write_rejected", 503);
  if (!del.data) return fail("not_found", 404);
  return json({ ok: true });
}

async function actChangePassword(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const d = body.data;
  const currentPassword = typeof d.currentPassword === "string" ? d.currentPassword : "";
  const newPassword = typeof d.newPassword === "string" ? d.newPassword : "";
  if (currentPassword.length < 1 || currentPassword.length > 128) return fail("invalid_input", 400);
  if (newPassword.length < 6 || newPassword.length > 128) return fail("invalid_password", 400);
  const row = await supabase.from("partners").select("id,password_hash").eq("id", auth.partner.id).maybeSingle();
  if (row.error || !row.data) return fail("database_request_failed", 503);
  if (!(await verifyPassword(currentPassword, row.data.password_hash))) return fail("invalid_credentials", 401);
  const upd = await supabase.from("partners")
    .update({ password_hash: await passwordRecord(newPassword) })
    .eq("id", auth.partner.id).select("id").maybeSingle();
  if (upd.error || !upd.data) return fail("write_rejected", 503);
  // Drop other sessions; keep the current one.
  const others = await supabase.from("sessions").delete().eq("partner_id", auth.partner.id).neq("token", auth.token).select("token");
  if (others.error) { /* best-effort */ }
  return json({ ok: true });
}

async function actRenameSelf(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request);
  if (body.error) return fail(body.error, 400);
  const newName = typeof body.data.name === "string" ? body.data.name.trim() : "";
  if (!validText(newName, 40)) return fail("invalid_name", 400);
  const upd = await supabase.from("partners")
    .update({ name: newName })
    .eq("id", auth.partner.id).select("id,name").maybeSingle();
  if (upd.error || !upd.data) return fail("write_rejected", 503);
  return json({ ok: true, name: upd.data.name });
}

async function actUpdateAvatar(request, supabase, params, auth) {
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  const body = await readJsonBody(request, MAX_AVATAR_BODY_CHARS);
  if (body.error) return fail(body.error, 400);
  const d = body.data;
  const rawEmoji = d.avatarEmoji ?? null;
  const rawUrl = d.avatarUrl ?? null;
  const emoji = rawEmoji === null
    ? null
    : (typeof rawEmoji === "string" && AVATAR_EMOJI.includes(rawEmoji) ? rawEmoji : undefined);
  if (emoji === undefined) return fail("invalid_avatar", 400);
  const url = rawUrl === null
    ? null
    : (typeof rawUrl === "string" && rawUrl.length <= MAX_AVATAR_URL_CHARS && AVATAR_DATA_RE.test(rawUrl)
      ? rawUrl
      : undefined);
  if (url === undefined) return fail("invalid_avatar", 400);
  const upd = await supabase.from("partners")
    .update({ avatar_emoji: emoji ?? "", avatar_url: url ?? "" })
    .eq("id", auth.partner.id).select("id").maybeSingle();
  if (upd.error || !upd.data) return fail("write_rejected", 503);
  return json({ ok: true, avatarEmoji: emoji, avatarUrl: url });
}

// ---------------------------------------------------------------- router

export async function handleApp({ request, supabase }) {
  try {
    const params = new URL(request.url).searchParams;
    const action = params.get("action") ?? "";
    if (action === "bootstrap") return await actBootstrap(request, supabase);
    if (action === "setup") return await actSetup(request, supabase);
    if (action === "accept_invite") return await actAcceptInvite(request, supabase);
    if (action === "join") return await actJoin(request, supabase);
    if (action === "login") return await actLogin(request, supabase);
    const auth = await requirePartner(request, supabase, params);
    if (!auth) return fail("login_required", 401);
    switch (action) {
      case "add_partner": return await actAddPartner(request, supabase, params, auth);
      case "regenerate_invite": return await actRegenerateInvite(request, supabase, params, auth);
      case "close_month": return await actCloseMonth(request, supabase, params, auth);
      case "reopen_month": return await actReopenMonth(request, supabase, params, auth);
      case "logout": return await actLogout(request, supabase, params);
      case "sync": return await actSync(request, supabase, params, auth);
      case "data": return await actData(request, supabase, params, auth);
      case "add_expense": return await actAddExpense(request, supabase, params, auth);
      case "update_expense": return await actUpdateExpense(request, supabase, params, auth);
      case "delete_expense": return await actDeleteExpense(request, supabase, params, auth);
      case "add_settlement": return await actAddSettlement(request, supabase, params, auth);
      case "delete_settlement": return await actDeleteSettlement(request, supabase, params, auth);
      case "add_recurring": return await actAddRecurring(request, supabase, params, auth);
      case "update_recurring": return await actUpdateRecurring(request, supabase, params, auth);
      case "delete_recurring": return await actDeleteRecurring(request, supabase, params, auth);
      case "change_password": return await actChangePassword(request, supabase, params, auth);
      case "rename_self": return await actRenameSelf(request, supabase, params, auth);
      case "update_avatar": return await actUpdateAvatar(request, supabase, params, auth);
      default: return fail("not_found", 404);
    }
  } catch (error) {
    // Server-side diagnosis only; never returned to the browser.
    console.error("handler error:", error?.message ?? error, error?.stack ?? "");
    return fail("database_request_failed", 503);
  }
}
