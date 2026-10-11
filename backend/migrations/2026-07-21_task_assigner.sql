-- Workspace — record who assigned each task
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Adds an assigner column (member id) to tasks, defaulting in the UI to
-- whoever is creating the task (changeable). Snapshot copied into
-- task_completions by the trigger so reports can show it.

alter table public.tasks add column if not exists assigner text;
alter table public.task_completions add column if not exists assigner text;

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
      (task_id, title, event, priority, assignee, assigner, completed_by,
       due, task_created_at, on_time, days_late, days_to_complete)
    values
      (new.id, new.title, new.event, new.priority, new.assignee, new.assigner,
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
