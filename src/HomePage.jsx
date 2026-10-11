import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase.js";
import {
  C, mono, sans, Logo, Avatar, Tag, taskAssignees, dueMeta, roleLabel, eventKind,
  fmtDateTime, isoDate, memberPerformance, pct, round1, card, sectionLabel, btn,
  inputStyle, labelStyle, Modal,
} from "./shared.jsx";

// ==================================================================
// Home — who you are, how you're tracking this year, what's next
// ==================================================================
export default function HomePage({ me, myRole, admin, members, tasks, calEvents, attendees, settings, reloadSettings, note, go }) {
  const [completions, setCompletions] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showReminders, setShowReminders] = useState(false);

  // RLS returns only the completions this person may see (their own for leaders)
  useEffect(() => {
    supabase.from("task_completions").select("*").then(({ data }) => setCompletions(data || []));
  }, []);

  const trackingStart = settings.tracking_start || `${new Date().getFullYear()}-01-01`;
  const perf = useMemo(
    () =>
      memberPerformance({
        memberId: me.id,
        from: trackingStart,
        to: isoDate(new Date()),
        completions,
        calEvents,
        attendees,
        benchmarkPerWeek: settings.benchmark_hours_per_week,
      }),
    [me.id, trackingStart, completions, calEvents, attendees, settings.benchmark_hours_per_week]
  );
  const myRow = members.find((m) => m.id === me.id) || {};
  const priorDeficit = Number(myRow.prior_deficit_hours) || 0;
  const deficit = round1(Math.max(0, priorDeficit + perf.benchmark - perf.hoursWorked));

  const myOpen = tasks
    .filter((t) => t.col !== "done" && taskAssignees(t).includes(me.id))
    .sort((a, b) => (a.due < b.due ? -1 : 1));
  const now = new Date();
  const myInvites = attendees
    .filter((a) => a.member_id === me.id)
    .map((a) => ({ ...a, ev: calEvents.find((e) => e.id === a.event_id) }))
    .filter((a) => a.ev && new Date(a.ev.starts_at) >= now)
    .sort((a, b) => (a.ev.starts_at < b.ev.starts_at ? -1 : 1));
  const pending = myInvites.filter((a) => a.rsvp === "pending").length;

  const sinceText = new Date(trackingStart).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  const tiles = [
    {
      n: `${perf.hoursWorked}h`,
      l: "Hours worked",
      d: `Task time plus events attended since ${sinceText}. Expected so far: ${perf.benchmark}h.`,
    },
    {
      n: `${deficit}h`,
      l: "Deficit",
      warn: deficit > 0,
      d: `Expected hours not yet worked${priorDeficit ? `, including ${priorDeficit}h carried over from before the app` : ""}.`,
    },
    {
      n: pct(perf.meetingsAttended, perf.meetingsInvited),
      l: "Meeting attendance",
      d: `${perf.meetingsAttended} of ${perf.meetingsInvited} team and leaders meetings since ${sinceText}.`,
    },
    {
      n: pct(perf.eventsAttended, perf.eventsInvited),
      l: "Event attendance",
      d: `${perf.eventsAttended} of ${perf.eventsInvited} major, minor and club events since ${sinceText}.`,
    },
  ];

  const linkBtn = {
    display: "flex", alignItems: "center", gap: 10, background: C.surface, border: `1px solid ${C.line}`,
    borderRadius: 10, padding: "12px 14px", cursor: "pointer", textDecoration: "none", color: C.ink,
    fontFamily: sans, fontSize: 13.5, fontWeight: 700, textAlign: "left",
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Profile + headline stats */}
      <div style={{ ...card, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 76, height: 76, borderRadius: "50%", background: C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
          {myRow.photo_url ? (
            <img src={myRow.photo_url} alt={me.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Logo size={52} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.ink }}>Hi, {me.name}</div>
          <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: C.accent, marginTop: 3 }}>
            {roleLabel(myRole)}{myRow.team ? ` · ${myRow.team} team` : ""}
          </div>
          <div style={{ fontSize: 13, color: C.inkSoft, marginTop: 6 }}>
            {myOpen.length} open task{myOpen.length === 1 ? "" : "s"}
            {pending ? ` · ${pending} event invitation${pending === 1 ? "" : "s"} waiting for your reply` : ""}
          </div>
        </div>
        {admin && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setShowReminders(true)} style={btn(C.accent)}>✉ Email reminders</button>
            <button onClick={() => setShowSettings(true)} style={btn(C.inkSoft)}>⚙ Settings</button>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        {tiles.map((t) => (
          <div key={t.l} style={card}>
            <div style={{ fontSize: 28, fontWeight: 800, color: t.warn ? C.red : C.ink, lineHeight: 1.1 }}>{t.n}</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0 8px" }}>{t.l}</div>
            <div style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.45 }}>{t.d}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        {/* My tasks */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={sectionLabel}>My open tasks</div>
            <button onClick={() => go("tasks")} style={{ background: "none", border: "none", color: C.accent, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>Task management →</button>
          </div>
          {myOpen.length === 0 && <div style={{ fontSize: 13, color: C.inkSoft }}>Nothing open — nice.</div>}
          {myOpen.slice(0, 6).map((t) => {
            const due = dueMeta(t);
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <Tag text={t.event} />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                <span style={{ fontFamily: mono, fontSize: 10.5, color: due.color, background: due.soft, padding: "2px 7px", borderRadius: 3, whiteSpace: "nowrap" }}>{due.text}</span>
              </div>
            );
          })}
          {myOpen.length > 6 && <div style={{ fontSize: 12, color: C.inkSoft, paddingTop: 6 }}>+{myOpen.length - 6} more</div>}
        </div>

        {/* Upcoming events */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={sectionLabel}>My upcoming events</div>
            <button onClick={() => go("events")} style={{ background: "none", border: "none", color: C.accent, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>Events →</button>
          </div>
          {myInvites.length === 0 && <div style={{ fontSize: 13, color: C.inkSoft }}>No upcoming invitations.</div>}
          {myInvites.slice(0, 6).map((a) => {
            const k = eventKind(a.ev.kind);
            return (
              <div key={a.event_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: k.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.ev.title}</div>
                  <div style={{ fontSize: 11.5, color: C.inkSoft }}>{k.label} · {fmtDateTime(a.ev.starts_at)}</div>
                </div>
                <span style={{
                  fontFamily: mono, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, padding: "2px 7px", borderRadius: 3,
                  color: a.rsvp === "yes" ? "#1F6F54" : a.rsvp === "no" ? C.red : C.amber,
                  background: a.rsvp === "yes" ? "#E3F1EA" : a.rsvp === "no" ? C.redSoft : C.amberSoft,
                }}>
                  {a.rsvp === "pending" ? "Reply needed" : a.rsvp === "yes" ? "Going" : "Can't go"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick links */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        {settings.drive_url ? (
          <a href={settings.drive_url} target="_blank" rel="noopener noreferrer" style={linkBtn}>
            <span style={{ fontSize: 18 }}>▲</span> Team Google Drive
          </a>
        ) : (
          <div style={{ ...linkBtn, cursor: "default", color: C.inkSoft, fontWeight: 600 }} title={admin ? "Add the link in ⚙ Settings" : "An exec can add the link"}>
            <span style={{ fontSize: 18 }}>▲</span> Google Drive (not linked yet)
          </div>
        )}
        <a href="https://mail.google.com" target="_blank" rel="noopener noreferrer" style={linkBtn}>
          <span style={{ fontSize: 18 }}>✉</span> Email
        </a>
        <button onClick={() => go("tasks")} style={linkBtn}><span style={{ fontSize: 18 }}>▦</span> Task management</button>
        <button onClick={() => go("debriefs")} style={linkBtn}><span style={{ fontSize: 18 }}>◷</span> Debriefs & performance</button>
        <button onClick={() => go("events")} style={linkBtn}><span style={{ fontSize: 18 }}>◈</span> Events</button>
      </div>

      {showSettings && admin && (
        <SettingsModal settings={settings} reloadSettings={reloadSettings} note={note} onClose={() => setShowSettings(false)} />
      )}
      {showReminders && admin && (
        <RemindersModal members={members} settings={settings} note={note} onClose={() => setShowReminders(false)} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Exec settings: benchmark hours, tracking start, Drive link, reminders
// ------------------------------------------------------------------
function SettingsModal({ settings, reloadSettings, note, onClose }) {
  const [f, setF] = useState({
    benchmark_hours_per_week: settings.benchmark_hours_per_week ?? 3,
    tracking_start: settings.tracking_start || `${new Date().getFullYear()}-01-01`,
    drive_url: settings.drive_url || "",
    reminder_days_ahead: settings.reminder_days_ahead ?? 2,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const drive = f.drive_url.trim();
    if (drive && !/^https:\/\//i.test(drive)) return note("Drive link must start with https://", true);
    setBusy(true);
    const rows = [
      { key: "benchmark_hours_per_week", value: Number(f.benchmark_hours_per_week) || 0 },
      { key: "tracking_start", value: f.tracking_start },
      { key: "drive_url", value: drive || null },
      { key: "reminder_days_ahead", value: Math.max(0, parseInt(f.reminder_days_ahead, 10) || 0) },
    ].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from("app_settings").upsert(rows);
    setBusy(false);
    if (error) return note("Couldn't save settings — exec access needed", true);
    await reloadSettings();
    note("Settings saved ✓");
    onClose();
  };

  return (
    <Modal onClose={onClose} maxWidth={420}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.ink }}>Settings (execs)</h2>
      <label style={labelStyle}>Benchmark hours per leader per week</label>
      <input style={inputStyle} type="number" min="0" step="0.5" value={f.benchmark_hours_per_week} onChange={(e) => set("benchmark_hours_per_week", e.target.value)} />
      <label style={labelStyle}>Count hours from (start of tracking)</label>
      <input style={inputStyle} type="date" value={f.tracking_start} onChange={(e) => set("tracking_start", e.target.value)} />
      <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 5, lineHeight: 1.45 }}>
        Home-page hours, deficit and attendance count from this date. Hours owed from before it go in each member's "deficit before app" (Team panel).
      </div>
      <label style={labelStyle}>Shared Google Drive link</label>
      <input style={inputStyle} value={f.drive_url} onChange={(e) => set("drive_url", e.target.value)} placeholder="https://drive.google.com/…" />
      <label style={labelStyle}>Email reminders: tasks due within (days)</label>
      <input style={inputStyle} type="number" min="0" value={f.reminder_days_ahead} onChange={(e) => set("reminder_days_ahead", e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button onClick={onClose} style={{ ...btn(C.inkSoft), flex: 1 }}>Cancel</button>
        <button onClick={save} disabled={busy} style={{ ...btn(C.accent, true), flex: 2, opacity: busy ? 0.6 : 1 }}>Save settings</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Email reminders — preview (dry run) and send via the send-reminders
// Edge Function. A daily schedule can call the same function.
// ------------------------------------------------------------------
function RemindersModal({ members, settings, note, onClose }) {
  const [preview, setPreview] = useState(null); // { recipients: [...] }
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");

  const call = async (dryRun) => {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.functions.invoke("send-reminders", { body: { dry_run: dryRun } });
    setBusy(false);
    if (error || data?.error) {
      setErr(data?.error || "Couldn't reach the reminders service. It needs deploying first (see CLAUDE.md).");
      return null;
    }
    return data;
  };
  useEffect(() => { call(true).then((d) => d && setPreview(d)); }, []);

  const send = async () => {
    setConfirm(false);
    const d = await call(false);
    if (d) {
      note(`Reminders sent to ${d.sent} ${d.sent === 1 ? "person" : "people"} ✓`);
      onClose();
    }
  };

  const recips = preview?.recipients || [];
  return (
    <Modal onClose={onClose} maxWidth={480}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.ink }}>Email reminders</h2>
      <p style={{ margin: "4px 0 12px", fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>
        Each person gets one short email with counts only — open tasks due within {settings.reminder_days_ahead ?? 2} days,
        overdue tasks and event invitations waiting for a reply — plus a link to the app. Task titles aren't included.
        Members switched off in the Team panel are skipped.
      </p>
      {busy && !preview && <div style={{ fontFamily: mono, fontSize: 11, color: C.inkSoft, padding: "12px 0" }}>Checking who's due a reminder…</div>}
      {err && (
        <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: C.ink }}>{err}</div>
      )}
      {preview && (
        <div style={{ background: C.bg, borderRadius: 8, padding: "6px 12px", maxHeight: 260, overflowY: "auto" }}>
          {recips.length === 0 && <div style={{ fontSize: 13, color: C.inkSoft, padding: "6px 0" }}>Nobody needs a reminder right now.</div>}
          {recips.map((r) => {
            const m = members.find((x) => x.id === r.member_id) || { name: r.name, initials: "?", color: "#8A8F9C" };
            return (
              <div key={r.member_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 12.5 }}>
                <Avatar m={m} size={22} />
                <span style={{ flex: 1, fontWeight: 600 }}>{m.name}</span>
                <span style={{ color: C.inkSoft }}>
                  {[r.due_soon && `${r.due_soon} due soon`, r.overdue && `${r.overdue} overdue`, r.invites && `${r.invites} invite${r.invites === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {confirm ? (
        <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 12px", marginTop: 14 }}>
          <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>
            Send reminder emails to <b>{recips.length}</b> {recips.length === 1 ? "person" : "people"} now?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={send} disabled={busy} style={btn(C.red, true)}>Yes, send</button>
            <button onClick={() => setConfirm(false)} style={btn(C.inkSoft)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...btn(C.inkSoft), flex: 1 }}>Close</button>
          <button
            onClick={() => setConfirm(true)}
            disabled={busy || !recips.length}
            style={{ ...btn(C.accent, true), flex: 2, opacity: busy || !recips.length ? 0.5 : 1 }}
          >
            Send now
          </button>
        </div>
      )}
    </Modal>
  );
}
