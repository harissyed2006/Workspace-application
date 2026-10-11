-- Workspace — admin-orderable events
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Adds sort_order to events; existing events numbered by creation date.
-- Reordering is done in the app by admins dragging the event tabs
-- (event UPDATE was already admin-only, so no policy changes needed).

alter table public.events add column if not exists sort_order int;

update public.events set sort_order = sub.rn
from (
  select id, row_number() over (order by created_at) as rn
  from public.events
) sub
where public.events.id = sub.id and public.events.sort_order is null;
