-- Workspace — seed a "General" event (default for new tasks)
-- Run this whole file in Supabase: SQL Editor → New query → Run
-- (No-op if a General event already exists — which it did on the live DB,
--  so this file was never needed there; kept for fresh environments.)

insert into public.events (name, sort_order)
select 'General', coalesce((select max(sort_order) from public.events), 0) + 1
where not exists (select 1 from public.events where lower(name) = 'general');
