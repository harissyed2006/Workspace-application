-- Workspace — recurring tasks + richer completion stats
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- 1. Recurrence: tasks can repeat daily / weekly / fortnightly / monthly /
--    quarterly / yearly. When a recurring task is completed, the trigger
--    spawns the next occurrence (due = previous due + interval, rolled
--    forward past today so an overdue chore doesn't spawn in the past).
-- 2. started_at: stamped the first time a task enters "In Progress", so
--    reports can show minutes actually spent working on it.

-- ---------- 1. New columns ----------
alter table public.tasks add column if not exists repeat_every text;  -- null = one-off
alter table public.tasks add column if not exists started_at timestamptz;
alter table public.tasks add column if not exists recurrence_root uuid; -- groups a series

alter table public.task_completions add column if not exists started_at timestamptz;
alter table public.task_completions add column if not exists minutes_worked int;

-- ---------- 2. Stamp started_at when a task first hits "doing" ----------
create or replace function public.stamp_task_started()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.col = 'doing' and new.started_at is null then
    new.started_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_task_started on public.tasks;
create trigger trg_stamp_task_started
  before insert or update on public.tasks
  for each row execute function public.stamp_task_started();

-- ---------- 3. Completion log carries the new measures ----------
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
       due, task_created_at, started_at, minutes_worked,
       on_time, days_late, days_to_complete)
    values
      (new.id, new.title, new.event, new.priority, new.assignee,
       coalesce(new.assignees, array[new.assignee]), new.assigner,
       lower(coalesce(auth.jwt() ->> 'email', 'unknown')),
       new.due, new.created_at, new.started_at,
       case when new.started_at is not null
            then greatest(0, (extract(epoch from (now() - new.started_at)) / 60)::int)
            else null end,
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

-- ---------- 4. Spawn the next occurrence of a recurring task ----------
create or replace function public.spawn_recurring_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  step interval;
  next_due date;
begin
  if new.repeat_every is null or new.col <> 'done'
     or (tg_op = 'UPDATE' and old.col = 'done') then
    return new;
  end if;

  step := case new.repeat_every
            when 'daily'       then interval '1 day'
            when 'weekly'      then interval '1 week'
            when 'fortnightly' then interval '2 weeks'
            when 'monthly'     then interval '1 month'
            when 'quarterly'   then interval '3 months'
            when 'yearly'      then interval '1 year'
            else null end;
  if step is null then return new; end if;

  -- Don't spawn a duplicate if one already exists for this series
  if exists (
    select 1 from public.tasks t
    where t.recurrence_root = coalesce(new.recurrence_root, new.id)
      and t.col <> 'done' and t.archived_at is null
  ) then
    return new;
  end if;

  next_due := new.due + step;
  while next_due < current_date loop
    next_due := next_due + step;
  end loop;

  insert into public.tasks
    (title, event, assignee, assignees, assigner, priority, due, col,
     description, executive, repeat_every, recurrence_root)
  values
    (new.title, new.event, new.assignee, new.assignees, new.assigner,
     new.priority, next_due, 'todo', new.description, new.executive,
     new.repeat_every, coalesce(new.recurrence_root, new.id));

  return new;
end $$;

drop trigger if exists trg_spawn_recurring_task on public.tasks;
create trigger trg_spawn_recurring_task
  after update on public.tasks
  for each row execute function public.spawn_recurring_task();

-- ---------- 5. Audit note for auto-created occurrences ----------
-- (audit_tasks already logs the INSERT; actor will be the completer's email)
