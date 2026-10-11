-- Workspace — OPTIONAL: send email reminders automatically every morning
-- Run only after:
--   1. sql/2026-10-11_events_debriefs_reminders.sql has been run, and
--   2. the send-reminders Edge Function is deployed with its secrets
--      (BREVO_API_KEY, REMINDER_FROM_EMAIL, APP_URL, CRON_SECRET).
-- Enable the pg_cron and pg_net extensions first (Database → Extensions).
--
-- Replace the two placeholders below before running. The CRON_SECRET value
-- must match the function's CRON_SECRET secret. It is kept in Supabase Vault
-- so it never sits in plain text in the cron table.

select vault.create_secret('<PASTE THE SAME CRON_SECRET VALUE HERE>', 'reminders_cron_secret');

-- 21:30 UTC = 8:30am Sydney (AEDT). Adjust when daylight saving ends.
select cron.schedule(
  'app-daily-reminders',
  '30 21 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To stop the schedule later:
--   select cron.unschedule('app-daily-reminders');
