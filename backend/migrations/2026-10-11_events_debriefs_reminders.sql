-- Workspace — team admins, scheduled events + attendance, debriefs,
-- task file links, app settings, email-reminder support.
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Additive and backward-compatible: the live site keeps working between
-- running this and deploying the code that uses it.
--
-- Role vocabulary used from here on (matches the features doc):
--   Exec        = roles.role 'owner' or 'admin'   (is_board_admin(), unchanged meaning)
--   Team admin  = roles.role 'team_admin'          (new; NOT an exec)
--   Leader      = no roles row                     (every other member)

-- ---------- 1. Roles: add 'team_admin' ----------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.roles'::regclass and contype = 'c'
  loop
    execute format('alter table public.roles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.roles
  add constraint roles_role_check check (role in ('owner','admin','team_admin'));

-- Execs only. Previously "has any roles row" — a team_admin row must NOT
-- grant exec powers, so the role is now checked explicitly.
create or replace function public.is_board_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.roles
    where email = public.current_board_email() and role in ('owner','admin')
  )
$$;

-- Execs or team admins
create or replace function public.is_team_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.roles
    where email = public.current_board_email() and role in ('owner','admin','team_admin')
  )
$$;

-- ---------- 2. Members: team, prior deficit, photo, reminder opt-out ----------
alter table public.members add column if not exists team text;                 -- e.g. "Events", "Media"
alter table public.members add column if not exists prior_deficit_hours numeric not null default 0;
alter table public.members add column if not exists photo_url text;
alter table public.members add column if not exists email_reminders boolean not null default true;

create or replace function public.current_member_id()
returns text language sql stable security definer set search_path = public
as $$ select id from public.members where email = public.current_board_email() limit 1 $$;

create or replace function public.current_member_team()
returns text language sql stable security definer set search_path = public
as $$ select team from public.members where email = public.current_board_email() limit 1 $$;

-- True when the caller may see this member's performance data:
-- execs see everyone, team admins see their own team, everyone sees themself.
create or replace function public.can_view_member(mid text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_board_admin()
      or mid = public.current_member_id()
      or (public.is_team_admin()
          and public.current_member_team() is not null
          and exists (select 1 from public.members m
                      where m.id = mid and m.team = public.current_member_team()))
$$;

-- ---------- 3. Tasks: file links ----------
alter table public.tasks add column if not exists links text[];

-- Leaders can read completion records for tasks they were on (debriefs and
-- the home page need them); team admins their team's. Execs still read all.
drop policy if exists "members read own completions" on public.task_completions;
create policy "members read own completions"
  on public.task_completions for select to authenticated
  using (exists (
    select 1 from unnest(coalesce(assignees, array[assignee])) a(mid)
    where public.can_view_member(a.mid)
  ));

-- ---------- 4. App settings (exec-editable) ----------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings readable by team" on public.app_settings;
create policy "settings readable by team"
  on public.app_settings for select to authenticated using (true);
drop policy if exists "execs write settings" on public.app_settings;
create policy "execs write settings"
  on public.app_settings for all to authenticated
  using (public.is_board_admin()) with check (public.is_board_admin());

insert into public.app_settings (key, value) values
  ('benchmark_hours_per_week', '3'),             -- expected hours per leader per week
  ('tracking_start', to_jsonb(to_char(date_trunc('year', now()), 'YYYY-MM-DD'))),
  ('drive_url', 'null'),                          -- shared Google Drive link for the home page
  ('reminder_days_ahead', '2')                    -- email reminders: "due within N days"
on conflict (key) do nothing;

-- ---------- 5. Scheduled / logged events ----------
-- Separate from public.events (which are the board's task categories).
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null check (kind in
    ('major_event','minor_event','club_event','team_meeting','leaders_meeting')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  description text,
  private boolean not null default false,       -- execs only
  created_by text,                              -- member id
  created_by_email text not null default public.current_board_email(),
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_event_attendees (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  rsvp text not null default 'pending' check (rsvp in ('pending','yes','no')),
  rsvp_reason text,
  responded_at timestamptz,
  attended boolean,                              -- null = not recorded yet
  primary key (event_id, member_id)
);

-- Who may create which kind (features doc):
--   major event + leaders meeting → execs; team meeting → team admins/execs;
--   minor event + club event → everyone.
create or replace function public.can_create_event_kind(k text)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when k in ('major_event','leaders_meeting') then public.is_board_admin()
    when k = 'team_meeting' then public.is_team_admin()
    else true
  end
$$;

create or replace function public.can_manage_event(eid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_board_admin() or exists (
    select 1 from public.calendar_events e
    where e.id = eid and e.created_by_email = public.current_board_email()
  )
$$;

alter table public.calendar_events enable row level security;
alter table public.calendar_event_attendees enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('calendar_events','calendar_event_attendees')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "read events (private = execs only)"
  on public.calendar_events for select to authenticated
  using (not private or public.is_board_admin());
create policy "create events by kind"
  on public.calendar_events for insert to authenticated
  with check (
    public.can_create_event_kind(kind)
    and (not private or public.is_board_admin())
    and created_by_email = public.current_board_email()
  );
create policy "creator or execs update events"
  on public.calendar_events for update to authenticated
  using (public.can_manage_event(id) and (not private or public.is_board_admin()))
  with check (public.can_create_event_kind(kind) and (not private or public.is_board_admin()));
create policy "creator or execs delete events"
  on public.calendar_events for delete to authenticated
  using (public.can_manage_event(id) and (not private or public.is_board_admin()));

create policy "read attendees of visible events"
  on public.calendar_event_attendees for select to authenticated
  using (exists (select 1 from public.calendar_events e where e.id = event_id));
create policy "event managers add attendees"
  on public.calendar_event_attendees for insert to authenticated
  with check (public.can_manage_event(event_id));
create policy "managers or the invitee update"
  on public.calendar_event_attendees for update to authenticated
  using (public.can_manage_event(event_id) or member_id = public.current_member_id())
  with check (public.can_manage_event(event_id) or member_id = public.current_member_id());
create policy "event managers remove attendees"
  on public.calendar_event_attendees for delete to authenticated
  using (public.can_manage_event(event_id));

-- An invitee may only answer the RSVP — attendance stays with the organiser.
create or replace function public.guard_attendee_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_event(old.event_id) then
    new.event_id := old.event_id;
    new.member_id := old.member_id;
    new.attended := old.attended;
  end if;
  if new.rsvp is distinct from old.rsvp then
    new.responded_at := now();
  end if;
  if new.rsvp <> 'no' then
    new.rsvp_reason := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_attendee_update on public.calendar_event_attendees;
create trigger trg_guard_attendee_update
  before update on public.calendar_event_attendees
  for each row execute function public.guard_attendee_update();

-- Audit trail for events
create or replace function public.audit_calendar_events()
returns trigger language plpgsql security definer set search_path = public
as $$
declare label text;
begin
  label := replace(coalesce(new.kind, old.kind), '_', ' ');
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(),
      'created ' || label || ' "' || new.title || '"'
      || case when new.private then ' [private]' else '' end);
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(), 'deleted ' || label || ' "' || old.title || '"');
  elsif new.starts_at is distinct from old.starts_at then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(),
      'rescheduled ' || label || ' "' || new.title || '" to '
      || to_char(new.starts_at at time zone 'Australia/Sydney', 'DD Mon YYYY HH24:MI'));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_audit_calendar_events on public.calendar_events;
create trigger trg_audit_calendar_events
  after insert or update or delete on public.calendar_events
  for each row execute function public.audit_calendar_events();

-- ---------- 6. Debriefs ----------
create table if not exists public.debriefs (
  id uuid primary key default gen_random_uuid(),
  member_id text not null references public.members(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  task_minutes int not null default 0,
  event_hours numeric not null default 0,
  tasks_completed int not null default 0,
  meetings_invited int not null default 0,
  meetings_attended int not null default 0,
  events_invited int not null default 0,
  events_attended int not null default 0,
  benchmark_hours numeric not null default 0,
  reflection text,
  items jsonb,                                   -- snapshot of the task/event lines
  created_by_email text not null default public.current_board_email(),
  submitted_at timestamptz not null default now(),
  check (period_end >= period_start)
);
alter table public.debriefs enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'debriefs'
  loop
    execute format('drop policy %I on public.debriefs', p.policyname);
  end loop;
end $$;

-- Leaders: only their own. Team admins: theirs + their team. Execs: all.
create policy "read debriefs by scope"
  on public.debriefs for select to authenticated
  using (public.can_view_member(member_id));
create policy "submit own debrief (execs any)"
  on public.debriefs for insert to authenticated
  with check (member_id = public.current_member_id() or public.is_board_admin());
create policy "edit own debrief (execs any)"
  on public.debriefs for update to authenticated
  using (member_id = public.current_member_id() or public.is_board_admin())
  with check (member_id = public.current_member_id() or public.is_board_admin());
create policy "delete own debrief (execs any)"
  on public.debriefs for delete to authenticated
  using (member_id = public.current_member_id() or public.is_board_admin());

create or replace function public.audit_debriefs()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(),
      'submitted a debrief for ' || new.member_id || ' ('
      || to_char(new.period_start, 'DD Mon') || ' – ' || to_char(new.period_end, 'DD Mon YYYY') || ')');
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(), 'deleted a debrief for ' || old.member_id);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_audit_debriefs on public.debriefs;
create trigger trg_audit_debriefs
  after insert or delete on public.debriefs
  for each row execute function public.audit_debriefs();

-- ---------- 7. Audit: log task completions too ----------
create or replace function public.audit_task_completions()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_log (actor, action)
  values (public.current_board_email(),
    'completed task "' || new.title || '"'
    || coalesce(' (' || new.minutes_worked || ' min)', ''));
  return new;
end $$;
drop trigger if exists trg_audit_task_completions on public.task_completions;
create trigger trg_audit_task_completions
  after insert on public.task_completions
  for each row execute function public.audit_task_completions();

-- ---------- 8. Realtime ----------
do $$
begin
  begin alter publication supabase_realtime add table public.calendar_events;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.calendar_event_attendees;
  exception when duplicate_object then null; end;
end $$;
