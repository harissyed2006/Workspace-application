-- Workspace — task archiving + completion data collection
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Adds:
--   1. Soft-archive columns on tasks (archived_at / archived_by)
--   2. is_board_admin() helper (email list MUST match ADMIN_EMAILS in App.jsx)
--   3. Tightened RLS on tasks: non-admins cannot see or touch archived tasks
--   4. task_completions table, filled automatically by a trigger whenever a
--      task is moved to Done. Admin-only read; clients can never write to it.

-- ---------- 1. Archive columns ----------
alter table public.tasks add column if not exists archived_at timestamptz;
alter table public.tasks add column if not exists archived_by text;

-- ---------- 2. Admin helper (keep in sync with ADMIN_EMAILS in App.jsx) ----------
create or replace function public.is_board_admin()
returns boolean
language sql stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'owner1@example.com',
    'owner2@example.com',
    'exec1@example.com'
  )
$$;

-- ---------- 3. Replace tasks policies ----------
-- Drop every existing policy on tasks (names vary between environments),
-- then recreate them with archive rules baked in.
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

-- Read: active tasks for everyone signed in; archived tasks admins-only.
create policy "read active tasks, admins read archived"
  on public.tasks for select to authenticated
  using (archived_at is null or public.is_board_admin());

-- Insert: any signed-in member, but nobody can create a pre-archived task.
create policy "insert active tasks"
  on public.tasks for insert to authenticated
  with check (archived_at is null);

-- Update: members can edit active tasks but cannot archive/unarchive
-- (the row they write must still have archived_at null). Admins can do both.
create policy "update tasks, only admins archive"
  on public.tasks for update to authenticated
  using (archived_at is null or public.is_board_admin())
  with check (archived_at is null or public.is_board_admin());

-- Delete: members can delete active tasks; archived tasks admins-only.
create policy "delete tasks, admins delete archived"
  on public.tasks for delete to authenticated
  using (archived_at is null or public.is_board_admin());

-- ---------- 4. Completion data collection ----------
create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  title text not null,
  event text not null,
  priority text not null,
  assignee text not null,           -- member id the task belonged to
  completed_by text,                -- login email of whoever moved it to Done
  completed_at timestamptz not null default now(),
  due date not null,
  task_created_at timestamptz not null,
  on_time boolean not null,         -- completed on or before the due date
  days_late int not null,           -- 0 when on time
  days_to_complete int not null,    -- creation → completion, in days
  reopened boolean not null default false  -- true if later moved back out of Done
);

alter table public.task_completions enable row level security;

-- Admin-only read. No insert/update/delete policies at all: clients can never
-- write here — only the security-definer trigger below can.
create policy "admins read completions"
  on public.task_completions for select to authenticated
  using (public.is_board_admin());

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
      (task_id, title, event, priority, assignee, completed_by,
       due, task_created_at, on_time, days_late, days_to_complete)
    values
      (new.id, new.title, new.event, new.priority, new.assignee,
       lower(coalesce(auth.jwt() ->> 'email', 'unknown')),
       new.due, new.created_at,
       current_date <= new.due,
       greatest(0, current_date - new.due),
       greatest(0, current_date - new.created_at::date));
  elsif tg_op = 'UPDATE' and old.col = 'done' and new.col is distinct from 'done' then
    -- Task pulled back out of Done: flag its standing completion as reopened.
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

drop trigger if exists trg_log_task_completion on public.tasks;
create trigger trg_log_task_completion
  after insert or update on public.tasks
  for each row execute function public.log_task_completion();
