-- Workspace — owner role + DB-driven members and roles
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Adds:
--   1. members table (replaces the hard-coded MEMBERS list in App.jsx)
--   2. roles table (email → owner|admin; replaces ADMIN_EMAILS + the email
--      list inside is_board_admin). Seeds two owners.
--   3. is_board_owner() / is_board_admin() now read the roles table, so
--      role changes take effect instantly with no code deploy. All existing
--      policies that call is_board_admin() pick this up automatically.
--   4. A trigger that refuses to demote/delete the last owner (lockout guard).
--   5. events policies rewritten to use is_board_admin() instead of
--      hard-coded emails.

-- ---------- 1. members ----------
create table if not exists public.members (
  id text primary key,              -- slug, e.g. 'owner1'
  name text not null,
  initials text not null,
  color text not null,              -- hex, e.g. '#4C5FD5'
  email text unique,                -- login email (lowercase), null = no login yet
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.members (id, name, initials, color, email) values
  ('owner1','Owner One','O1','#4C5FD5','owner1@example.com'),
  ('owner2','Owner Two','O2','#3E7A8C','owner2@example.com'),
  ('exec1','Exec One','E1','#5E7A2E','exec1@example.com')
  -- (real member list removed from the public copy)
on conflict (id) do nothing;

-- ---------- 2. roles ----------
create table if not exists public.roles (
  email text primary key,           -- lowercase login email
  role text not null check (role in ('owner','admin')),
  updated_at timestamptz not null default now()
);

insert into public.roles (email, role) values
  ('owner1@example.com','owner'),
  ('owner2@example.com','owner'),
  ('exec1@example.com','admin')
on conflict (email) do update set role = excluded.role;

-- ---------- 3. Role helper functions ----------
create or replace function public.current_board_email()
returns text language sql stable
as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- security definer: these are called from RLS policies (including the roles
-- table's own policies), so they must bypass RLS to avoid recursion.
create or replace function public.is_board_owner()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.roles
    where email = public.current_board_email() and role = 'owner'
  )
$$;

create or replace function public.is_board_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.roles
    where email = public.current_board_email()
  )
$$;

-- ---------- Policies for members + roles ----------
alter table public.members enable row level security;
alter table public.roles enable row level security;

do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('members','roles')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "members readable by team"
  on public.members for select to authenticated using (true);
create policy "owners insert members"
  on public.members for insert to authenticated with check (public.is_board_owner());
create policy "owners update members"
  on public.members for update to authenticated
  using (public.is_board_owner()) with check (public.is_board_owner());
create policy "owners delete members"
  on public.members for delete to authenticated using (public.is_board_owner());

create policy "roles readable by team"
  on public.roles for select to authenticated using (true);
create policy "owners insert roles"
  on public.roles for insert to authenticated with check (public.is_board_owner());
create policy "owners update roles"
  on public.roles for update to authenticated
  using (public.is_board_owner()) with check (public.is_board_owner());
create policy "owners delete roles"
  on public.roles for delete to authenticated using (public.is_board_owner());

-- ---------- 4. Last-owner lockout guard ----------
create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and (select count(*) from public.roles where role = 'owner') <= 1 then
    raise exception 'Cannot remove the last owner';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_protect_last_owner on public.roles;
create trigger trg_protect_last_owner
  before update or delete on public.roles
  for each row execute function public.protect_last_owner();

-- ---------- 5. events policies → role-table driven ----------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'events'
  loop
    execute format('drop policy %I on public.events', p.policyname);
  end loop;
end $$;

create policy "events readable by team"
  on public.events for select to authenticated using (true);
create policy "admins insert events"
  on public.events for insert to authenticated with check (public.is_board_admin());
create policy "admins update events"
  on public.events for update to authenticated
  using (public.is_board_admin()) with check (public.is_board_admin());
create policy "admins delete events"
  on public.events for delete to authenticated using (public.is_board_admin());

-- ---------- Realtime for members ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'members'
  ) then
    alter publication supabase_realtime add table public.members;
  end if;
end $$;
