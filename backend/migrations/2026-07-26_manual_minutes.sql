-- Workspace — manual "minutes spent" + completion notes
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Replaces the auto-measured In-Progress duration with a value the person
-- types when they complete the task, plus free-text notes. The completion
-- trigger now snapshots whatever was entered instead of computing elapsed
-- wall-clock time.

alter table public.tasks add column if not exists minutes_spent int;
alter table public.tasks add column if not exists completion_notes text;
alter table public.task_completions add column if not exists completion_notes text;

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
       due, task_created_at, started_at, minutes_worked, completion_notes,
       on_time, days_late, days_to_complete)
    values
      (new.id, new.title, new.event, new.priority, new.assignee,
       coalesce(new.assignees, array[new.assignee]), new.assigner,
       lower(coalesce(auth.jwt() ->> 'email', 'unknown')),
       new.due, new.created_at, new.started_at,
       new.minutes_spent,           -- manually entered on completion
       new.completion_notes,
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

-- Recurring occurrences must start fresh: don't carry minutes/notes forward
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
