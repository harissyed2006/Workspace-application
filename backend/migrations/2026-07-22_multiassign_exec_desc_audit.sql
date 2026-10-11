-- Workspace — multi-assignee, executive tasks, descriptions,
--                   audit log, owner stats reset
-- Run this whole file in Supabase: SQL Editor → New query → Run

-- ---------- 1. New task columns ----------
alter table public.tasks add column if not exists assignees text[];
update public.tasks set assignees = array[assignee] where assignees is null;
alter table public.tasks alter column assignees set default '{}'::text[];
alter table public.tasks alter column assignees set not null;
alter table public.tasks add column if not exists executive boolean not null default false;
alter table public.tasks add column if not exists description text;

alter table public.task_completions add column if not exists assignees text[];
update public.task_completions set assignees = array[assignee] where assignees is null;

-- ---------- 2. tasks policies: gate executive tasks to admins ----------
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

create policy "read tasks (archived+executive admins only)"
  on public.tasks for select to authenticated
  using (
    (archived_at is null or public.is_board_admin())
    and (not executive or public.is_board_admin())
  );

create policy "insert tasks (executive admins only)"
  on public.tasks for insert to authenticated
  with check (
    archived_at is null
    and (not executive or public.is_board_admin())
  );

create policy "update tasks (archive+executive admins only)"
  on public.tasks for update to authenticated
  using (
    (archived_at is null or public.is_board_admin())
    and (not executive or public.is_board_admin())
  )
  with check (
    (archived_at is null or public.is_board_admin())
    and (not executive or public.is_board_admin())
  );

create policy "delete tasks (archived+executive admins only)"
  on public.tasks for delete to authenticated
  using (
    (archived_at is null or public.is_board_admin())
    and (not executive or public.is_board_admin())
  );

-- ---------- 3. Completion trigger snapshots all assignees ----------
create or replace function public.log_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.col = 'done')
     or (tg_op = 'UPDATE' and new.col = 'done' and old.col is distinct from 'done') then
    insert into public.task_completions
      (task_id, title, event, priority, assignee, assignees, assigner, completed_by,
       due, task_created_at, on_time, days_late, days_to_complete)
    values
      (new.id, new.title, new.event, new.priority, new.assignee,
       coalesce(new.assignees, array[new.assignee]), new.assigner,
       lower(coalesce(auth.jwt() ->> 'email', 'unknown')),
       new.due, new.created_at,
       current_date <= new.due,
       greatest(0, current_date - new.due),
       greatest(0, current_date - new.created_at::date));
  elsif tg_op = 'UPDATE' and old.col = 'done' and new.col is distinct from 'done' then
    update public.task_completions
      set reopened = true
      where id = (
        select id from public.task_completions
        where task_id = new.id and reopened = false
        order by completed_at desc
        limit 1
      );
  end if;
  return new;
end $$;

-- ---------- 4. Audit log (admin-read, trigger-written only) ----------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text,                      -- login email of who did it
  action text not null,            -- human-readable description
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'audit_log'
  loop
    execute format('drop policy %I on public.audit_log', p.policyname);
  end loop;
end $$;

create policy "admins read audit log"
  on public.audit_log for select to authenticated
  using (public.is_board_admin());
-- no insert/update/delete policies: only the security-definer triggers write.

create or replace function public.audit_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(),
      'created task "' || new.title || '" (' || new.event || ')'
      || case when new.executive then ' [executive]' else '' end);
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(), 'deleted task "' || old.title || '"');
  elsif tg_op = 'UPDATE' then
    if new.archived_at is not null and old.archived_at is null then
      insert into public.audit_log (actor, action)
      values (public.current_board_email(), 'archived task "' || new.title || '"');
    elsif new.archived_at is null and old.archived_at is not null then
      insert into public.audit_log (actor, action)
      values (public.current_board_email(), 'restored task "' || new.title || '" from the archive');
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit_tasks on public.tasks;
create trigger trg_audit_tasks
  after insert or update or delete on public.tasks
  for each row execute function public.audit_tasks();

create or replace function public.audit_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action)
    values (public.current_board_email(), 'created event "' || new.name || '"');
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

drop trigger if exists trg_audit_events on public.events;
create trigger trg_audit_events
  after insert or update or delete on public.events
  for each row execute function public.audit_events();

-- One audit entry per stats reset (statement-level, not per row)
create or replace function public.audit_completions_reset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (actor, action)
  values (public.current_board_email(), 'reset all completion stats');
  return null;
end $$;

drop trigger if exists trg_audit_completions_reset on public.task_completions;
create trigger trg_audit_completions_reset
  after delete on public.task_completions
  for each statement execute function public.audit_completions_reset();

-- ---------- 5. Owners can wipe the stats ----------
drop policy if exists "owners reset completions" on public.task_completions;
create policy "owners reset completions"
  on public.task_completions for delete to authenticated
  using (public.is_board_owner());
