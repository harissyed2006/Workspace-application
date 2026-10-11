-- Workspace — executive events
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Events can be marked executive (admins only can create them — event writes
-- were already admin-only). Non-admins can't see an executive event OR any
-- task under it, enforced here in RLS.

alter table public.events add column if not exists executive boolean not null default false;

-- Events: hide executive events from non-admins
drop policy if exists "events readable by team" on public.events;
create policy "events readable by team"
  on public.events for select to authenticated
  using (not executive or public.is_board_admin());

-- Tasks: recreate the four policies with the executive-event clause added
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'tasks'
  loop
    execute format('drop policy %I on public.tasks', p.policyname);
  end loop;
end $$;

create policy "read tasks (archived/exec/exec-event admins only)"
  on public.tasks for select to authenticated
  using (
    (archived_at is null or public.is_board_admin())
    and (not executive or public.is_board_admin())
    and (not exists (select 1 from public.events e where e.name = tasks.event and e.executive)
         or public.is_board_admin())
  );

create policy "insert tasks (exec/exec-event admins only)"
  on public.tasks for insert to authenticated
  with check (
    archived_at is null
    and (not executive or public.is_board_admin())
    and (not exists (select 1 from public.events e where e.name = tasks.event and e.executive)
         or public.is_board_admin())
  );

create policy "update tasks (archived/exec/exec-event admins only)"
  on public.tasks for update to authenticated
  using (
    (archived_at is null or public.is_board_admin())
    and (not executive or public.is_board_admin())
    and (not exists (select 1 from public.events e where e.name = tasks.event and e.executive)
         or public.is_board_admin())
  )
  with check (
    (archived_at is null or public.is_board_admin())
    and (not executive or public.is_board_admin())
    and (not exists (select 1 from public.events e where e.name = tasks.event and e.executive)
         or public.is_board_admin())
  );

create policy "delete tasks (archived/exec/exec-event admins only)"
  on public.tasks for delete to authenticated
  using (
    (archived_at is null or public.is_board_admin())
    and (not executive or public.is_board_admin())
    and (not exists (select 1 from public.events e where e.name = tasks.event and e.executive)
         or public.is_board_admin())
  );

-- Audit: tag executive events in the "created event" entries
create or replace function public.audit_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(),
      'created event "' || new.name || '"'
      || case when new.executive then ' [executive]' else '' end);
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(), 'deleted event "' || old.name || '"');
  elsif tg_op = 'UPDATE' and new.name is distinct from old.name then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(),
      'renamed event "' || old.name || '" to "' || new.name || '"');
  end if;
  return coalesce(new, old);
end $$;
