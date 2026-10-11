// Workspace — email reminders (Brevo)
// Each active member with reminders on gets ONE short email with counts only
// (tasks due soon, overdue tasks, event invitations awaiting a reply) and a
// link to the app. No task titles or details go into email.
//
// Who can call it (both checked below, so deploy with Verify JWT OFF — the
// schedule has no user JWT to send):
//   - an exec (owner/admin) from the app — their JWT is verified via auth.getUser;
//   - a daily schedule (pg_cron + pg_net) sending header x-cron-secret.
// Body: { dry_run?: boolean } — dry run returns who would be emailed, sends nothing.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   BREVO_API_KEY, REMINDER_FROM_EMAIL, APP_URL, CRON_SECRET
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically)

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Today's date in Sydney (the team's timezone), as YYYY-MM-DD
const sydneyToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Caller check: cron secret, or a signed-in exec ----
    const cronSecret = Deno.env.get("CRON_SECRET");
    const viaCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    let actor = "scheduled reminders";
    if (!viaCron) {
      const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      const { data: caller } = await db.auth.getUser(jwt);
      const email = (caller?.user?.email || "").toLowerCase();
      if (!email) return json(401, { error: "Not signed in" });
      const { data: role } = await db.from("roles").select("role").eq("email", email).maybeSingle();
      if (!["owner", "admin"].includes(role?.role)) return json(403, { error: "Execs only" });
      actor = email;
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = !!body.dry_run;

    // ---- Gather counts ----
    const { data: setting } = await db
      .from("app_settings").select("value").eq("key", "reminder_days_ahead").maybeSingle();
    const daysAhead = Number(setting?.value ?? 2);
    const today = sydneyToday();
    const horizon = addDays(today, daysAhead);

    const [{ data: members }, { data: tasks }, { data: invites }] = await Promise.all([
      db.from("members").select("id, name, email, active, email_reminders"),
      db.from("tasks").select("assignee, assignees, due, col")
        .is("archived_at", null).neq("col", "done").lte("due", horizon),
      db.from("calendar_event_attendees")
        .select("member_id, rsvp, calendar_events!inner(starts_at)")
        .eq("rsvp", "pending")
        .gte("calendar_events.starts_at", new Date().toISOString()),
    ]);

    const recipients = (members || [])
      .filter((m) => m.active && m.email && m.email_reminders !== false)
      .map((m) => {
        const mine = (tasks || []).filter((t) =>
          (t.assignees?.length ? t.assignees : [t.assignee]).includes(m.id)
        );
        return {
          member_id: m.id,
          name: m.name,
          email: m.email,
          overdue: mine.filter((t) => t.due < today).length,
          due_soon: mine.filter((t) => t.due >= today).length,
          invites: (invites || []).filter((i) => i.member_id === m.id).length,
        };
      })
      .filter((r) => r.overdue || r.due_soon || r.invites);

    if (dryRun) {
      return json(200, {
        dry_run: true,
        days_ahead: daysAhead,
        // Execs see names + counts only, never other people's email addresses
        recipients: recipients.map(({ email: _e, ...r }) => r),
      });
    }

    // ---- Send ----
    const apiKey = Deno.env.get("BREVO_API_KEY");
    const from = Deno.env.get("REMINDER_FROM_EMAIL");
    const appUrl = Deno.env.get("APP_URL") || "";
    if (!apiKey || !from) return json(500, { error: "Email isn't set up yet (BREVO_API_KEY / REMINDER_FROM_EMAIL)" });

    let sent = 0;
    const failed: string[] = [];
    for (const r of recipients) {
      const lines = [
        r.overdue && plural(r.overdue, "task is overdue", "tasks are overdue"),
        r.due_soon && `${plural(r.due_soon, "task is", "tasks are")} due in the next ${plural(daysAhead, "day", "days")}`,
        r.invites && `${plural(r.invites, "event invitation is", "event invitations are")} waiting for your reply`,
      ].filter(Boolean) as string[];
      const first = r.name.split(" ")[0];
      const html = `<div style="font-family:Segoe UI,system-ui,sans-serif;color:#1E2230;max-width:480px">
<p>Hi ${first},</p>
<p>A quick reminder from Workspace:</p>
<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
${appUrl ? `<p><a href="${appUrl}" style="color:#4C5FD5;font-weight:700">Open Workspace</a></p>` : ""}
<p style="color:#646B7A;font-size:12px">You get this because you're on the team. Ask an owner to switch reminders off.</p>
</div>`;
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: "Workspace", email: from },
          to: [{ email: r.email, name: r.name }],
          subject: "Workspace reminder",
          htmlContent: html,
          textContent: `Hi ${first},\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\n${appUrl}`,
        }),
      });
      if (res.ok) sent++;
      else failed.push(r.name);
    }

    await db.from("audit_log").insert({
      actor,
      action: `sent ${plural(sent, "reminder email", "reminder emails")}${failed.length ? `, ${failed.length} failed` : ""}`,
    });

    return json(200, { sent, failed });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
});
