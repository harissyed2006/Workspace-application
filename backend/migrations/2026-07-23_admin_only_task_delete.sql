-- Workspace — restrict task deletion to admins
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Members can still create/edit/move tasks; only admins (and owners) can
-- delete them. Limits the damage a compromised member account could do.

drop policy if exists "delete tasks (archived/exec/exec-event admins only)" on public.tasks;
create policy "delete tasks (admins only)"
  on public.tasks for delete to authenticated
  using (public.is_board_admin());
