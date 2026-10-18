-- Partners Expenses: private book onboarding, migration 001.
-- Target ONLY: the new owner-managed Supabase project dulbjaoszcndrzgtxrub.
-- Review and run once in its SQL Editor, after revoking the exposed secret key.
-- Creates new tables. Does not read, copy, delete or alter the legacy Qoder ledger.
-- No passwords, service keys, sample users or financial records are included.
-- All statements run atomically. If this migration already ran, do not drop tables
-- or rerun it to reset data. Ledger import is a separate, reviewed step.

begin;

create schema if not exists partners_private;
revoke all on schema partners_private from public, anon;
grant usage on schema partners_private to authenticated;

create table public.expense_books (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  currency_code text not null check (currency_code in ('INR','USD','EUR','GBP','AED','SAR','SGD','AUD','CAD','JPY','CNY')),
  currency_minor_digits smallint not null check (currency_minor_digits in (0,2)),
  default_split text not null check (default_split in ('equal','personal','custom')),
  created_at timestamptz not null default now(),
  check (currency_minor_digits = case when currency_code = 'JPY' then 0 else 2 end)
);

create table public.book_members (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.expense_books(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  role text not null check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  unique (book_id, user_id),
  unique (book_id, id)
);
create index book_members_user_idx on public.book_members(user_id, book_id);
create unique index book_members_one_owner_idx on public.book_members(book_id) where role = 'owner';

-- Invite links are reusable for the named book for seven days, not login links.
-- Only a hash is stored; possession grants no access without a signed-in account.
create table public.book_invitations (
  book_id uuid primary key references public.expense_books(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.expense_books enable row level security;
alter table public.book_members enable row level security;
alter table public.book_invitations enable row level security;

revoke all on public.expense_books, public.book_members, public.book_invitations from public, anon, authenticated;
grant select on public.expense_books, public.book_members to authenticated;

-- The helper avoids recursive RLS on the membership table. It returns only the
-- calling account's membership decision and never accepts a client user ID.
create function partners_private.is_book_member(p_book_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.book_members m
    where m.book_id = p_book_id and m.user_id = (select auth.uid())
  );
$$;
revoke all on function partners_private.is_book_member(uuid) from public, anon;
grant execute on function partners_private.is_book_member(uuid) to authenticated;

create policy books_member_read on public.expense_books
  for select to authenticated
  using (partners_private.is_book_member(id));
create policy members_book_read on public.book_members
  for select to authenticated
  using (partners_private.is_book_member(book_id));
-- No direct INSERT/UPDATE/DELETE policies and no invitation SELECT policy.
-- Writes are exposed only through the narrowly scoped transactional RPCs below.

create function public.create_expense_book(
  p_id uuid,
  p_name text,
  p_currency_code text,
  p_default_split text,
  p_display_name text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_book public.expense_books%rowtype;
begin
  if v_user is null then raise exception 'login_required' using errcode = '42501'; end if;
  if p_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 80
     or p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 40
     or p_currency_code is null or p_currency_code not in ('INR','USD','EUR','GBP','AED','SAR','SGD','AUD','CAD','JPY','CNY')
     or p_default_split is null or p_default_split not in ('equal','personal','custom') then
    raise exception 'invalid_book' using errcode = '22023';
  end if;

  insert into public.expense_books (id, owner_id, name, currency_code, currency_minor_digits, default_split)
  values (p_id, v_user, btrim(p_name), p_currency_code, case when p_currency_code = 'JPY' then 0 else 2 end, p_default_split)
  on conflict (id) do nothing;

  select * into v_book from public.expense_books where id = p_id for update;
  -- The client-generated ID is an idempotency key, never proof of ownership.
  if v_book.owner_id <> v_user then raise exception 'access_denied' using errcode = '42501'; end if;
  if v_book.name <> btrim(p_name) or v_book.currency_code <> p_currency_code
     or v_book.default_split <> p_default_split
     or exists (select 1 from public.book_members
       where book_id = p_id and user_id = v_user and display_name <> btrim(p_display_name)) then
    raise exception 'operation_conflict' using errcode = '22023';
  end if;

  insert into public.book_members (book_id, user_id, display_name, role)
  values (p_id, v_user, btrim(p_display_name), 'owner')
  on conflict (book_id, user_id) do nothing;
  return p_id;
end;
$$;

create function public.create_book_invite(p_book_id uuid, p_token text)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_hash text;
  v_expires timestamptz;
begin
  if v_user is null then raise exception 'login_required' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_invite' using errcode = '22023';
  end if;
  -- Serialize invite rotation/revocation with acceptance on the same book.
  select owner_id into v_owner from public.expense_books where id = p_book_id for update;
  if v_owner is distinct from v_user then raise exception 'access_denied' using errcode = '42501'; end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select expires_at into v_expires from public.book_invitations
    where book_id = p_book_id and token_hash = v_hash;
  if found then return v_expires; end if;

  v_expires := now() + interval '7 days';
  insert into public.book_invitations (book_id, token_hash, created_by, expires_at)
  values (p_book_id, v_hash, v_user, v_expires)
  on conflict (book_id) do update set
    token_hash = excluded.token_hash, created_by = excluded.created_by,
    created_at = now(), expires_at = excluded.expires_at;
  return v_expires;
end;
$$;

create function public.revoke_book_invite(p_book_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
begin
  if v_user is null then raise exception 'login_required' using errcode = '42501'; end if;
  select owner_id into v_owner from public.expense_books where id = p_book_id for update;
  if v_owner is distinct from v_user then raise exception 'access_denied' using errcode = '42501'; end if;
  delete from public.book_invitations where book_id = p_book_id;
end;
$$;

create function public.accept_book_invite(p_token text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_book_id uuid;
begin
  if v_user is null then raise exception 'login_required' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_invite' using errcode = '22023';
  end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 40 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select book_id into v_book_id from public.book_invitations
    where token_hash = v_hash and expires_at > clock_timestamp();
  if v_book_id is null then raise exception 'invalid_invite' using errcode = '22023'; end if;
  perform 1 from public.expense_books where id = v_book_id for update;
  -- A concurrent rotation may have changed the invitation while we waited.
  if not exists (select 1 from public.book_invitations
    where book_id = v_book_id and token_hash = v_hash and expires_at > clock_timestamp()) then
    raise exception 'invalid_invite' using errcode = '22023';
  end if;
  insert into public.book_members (book_id, user_id, display_name, role)
  values (v_book_id, v_user, btrim(p_display_name), 'member')
  on conflict (book_id, user_id) do nothing;
  return v_book_id;
end;
$$;

revoke all on function public.create_expense_book(uuid,text,text,text,text) from public, anon;
revoke all on function public.create_book_invite(uuid,text) from public, anon;
revoke all on function public.revoke_book_invite(uuid) from public, anon;
revoke all on function public.accept_book_invite(text,text) from public, anon;
grant execute on function public.create_expense_book(uuid,text,text,text,text) to authenticated;
grant execute on function public.create_book_invite(uuid,text) to authenticated;
grant execute on function public.revoke_book_invite(uuid) to authenticated;
grant execute on function public.accept_book_invite(text,text) to authenticated;

comment on table public.expense_books is 'Private expense books. Membership-gated reads; creation is transactional.';
comment on table public.book_invitations is 'Hashed seven-day group invitations; not account login tokens.';
notify pgrst, 'reload schema';
commit;
