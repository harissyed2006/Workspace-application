-- Workspace — owners can clear the audit log
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Owners get DELETE on audit_log; a statement-level trigger writes one
-- "cleared the audit log" entry after the wipe, so a clear always leaves
-- an accountable trace of who did it and when.

drop policy if exists "owners reset audit log" on public.audit_log;
create policy "owners reset audit log"
  on public.audit_log for delete to authenticated
  using (public.is_board_owner());

create or replace function public.audit_log_reset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (actor, action)
  values (public.current_board_email(), 'cleared the audit log');
  return null;
end $$;

drop trigger if exists trg_audit_log_reset on public.audit_log;
create trigger trg_audit_log_reset
  after delete on public.audit_log
  for each statement execute function public.audit_log_reset();
