import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase.js";
import {
  C, mono, sans, Avatar, member, eventKind, fmtDate, fmtMinutes, isoDate, round1, pct,
  memberPerformance, eventHours, saveBlob, card, sectionLabel, btn, inputStyle, labelStyle, Modal,
} from "./shared.jsx";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
};

// ==================================================================
// Debriefs & performance
//   Leaders: build + submit their own debriefs, see only their own.
//   Team admins: theirs + their team's debriefs and statistics.
//   Execs: everyone's, plus the leader statistics table.
// Scope is enforced by RLS (can_view_member); the UI just mirrors it.
// ==================================================================
export default function DebriefsPage({ me, admin, teamAdmin, members, calEvents, attendees, settings, eventNames, note }) {
  const [completions, setCompletions] = useState([]);
  const [debriefs, setDebriefs] = useState(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);

  const load = async () => {
    const [c, d] = await Promise.all([
      supabase.from("task_completions").select("*"),
      supabase.from("debriefs").select("*").order("submitted_at", { ascending: false }),
    ]);
    setCompletions(c.data || []);
    if (d.error) {
      setDebriefs([]);
      note("Couldn't load debriefs — the database update may not be run yet", true);
    } else setDebriefs(d.data);
  };
  useEffect(() => { load(); }, []);

  const myTeam = members.find((m) => m.id === me.id)?.team || null;
  const scopeMembers = members.filter(
    (m) => m.active && (admin || m.id === me.id || (teamAdmin && myTeam && m.team === myTeam))
  );
  const lastMine = (debriefs || []).find((d) => d.member_id === me.id);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>Debriefs</div>
          <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3, lineHeight: 1.5 }}>
            Pick a period and your completed tasks and attended events are pulled in automatically, with hours tallied
            against the {settings.benchmark_hours_per_week ?? 3}h/week benchmark.
            {lastMine ? ` Your last debrief covered up to ${fmtDate(lastMine.period_end)}.` : ""}
          </div>
        </div>
        <button onClick={() => setCreating(true)} disabled={me.id === "?"} style={btn(C.accent, true)}>+ New debrief</button>
      </div>

      {(admin || teamAdmin) && (
        <LeaderStats
          members={scopeMembers}
          completions={completions}
          calEvents={calEvents}
          attendees={attendees}
          debriefs={debriefs || []}
          settings={settings}
          title={admin ? "Leader statistics" : `${myTeam || "Your"} team statistics`}
        />
      )}

      <div style={card}>
        <div style={sectionLabel}>
          {admin ? "All debrief submissions" : teamAdmin ? "Your team's debriefs" : "Your debriefs"} · {(debriefs || []).length}
        </div>
        {debriefs === null && <div style={{ fontFamily: mono, fontSize: 11, color: C.inkSoft }}>Loading…</div>}
        {debriefs && debriefs.length === 0 && <div style={{ fontSize: 13, color: C.inkSoft }}>No debriefs submitted yet.</div>}
        {debriefs && debriefs.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["Leader", "Period", "Hours", "Benchmark", "Tasks", "Meetings", "Events", "Submitted"].map((h) => (
                    <th key={h} style={{ textAlign: "left", fontFamily: mono, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: C.inkSoft, fontWeight: 500, padding: "6px 8px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {debriefs.map((d) => {
                  const m = member(members, d.member_id);
                  const hours = round1(d.task_minutes / 60 + Number(d.event_hours));
                  const short = hours < Number(d.benchmark_hours);
                  return (
                    <tr key={d.id} onClick={() => setViewing(d)} style={{ cursor: "pointer" }} className="app-row">
                      <td style={td}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Avatar m={m} size={22} />{m.name}</span></td>
                      <td style={td}>{fmtDate(d.period_start)} – {fmtDate(d.period_end)}</td>
                      <td style={{ ...td, fontWeight: 700, color: short ? C.red : "#1F6F54" }}>{hours}h</td>
                      <td style={td}>{round1(Number(d.benchmark_hours))}h</td>
                      <td style={td}>{d.tasks_completed}</td>
                      <td style={td}>{pct(d.meetings_attended, d.meetings_invited)}</td>
                      <td style={td}>{pct(d.events_attended, d.events_invited)}</td>
                      <td style={{ ...td, color: C.inkSoft }}>{fmtDate(d.submitted_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <DebriefBuilder
          me={me}
          members={members}
          completions={completions}
          calEvents={calEvents}
          attendees={attendees}
          settings={settings}
          eventNames={eventNames}
          defaultFrom={lastMine ? isoDate(new Date(new Date(lastMine.period_end).getTime() + 86400000)) : daysAgo(27)}
          note={note}
          reload={load}
          onClose={() => setCreating(false)}
        />
      )}
      {viewing && <DebriefView d={viewing} members={members} onClose={() => setViewing(null)} />}
    </div>
  );
}

const td = { padding: "8px 8px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" };

// ------------------------------------------------------------------
// Statistics table for execs (everyone) / team admins (their team)
// ------------------------------------------------------------------
function LeaderStats({ members, completions, calEvents, attendees, debriefs, settings, title }) {
  const [from, setFrom] = useState(daysAgo(27));
  const [to, setTo] = useState(isoDate(new Date()));
  const rows = useMemo(
    () =>
      members.map((m) => {
        const p = memberPerformance({
          memberId: m.id, from, to, completions, calEvents, attendees,
          benchmarkPerWeek: settings.benchmark_hours_per_week,
        });
        const submitted = debriefs.filter((d) => d.member_id === m.id && d.period_end >= from && d.period_start <= to).length;
        return { m, p, diff: round1(p.hoursWorked - p.benchmark), submitted };
      }),
    [members, from, to, completions, calEvents, attendees, debriefs, settings.benchmark_hours_per_week]
  );

  const exportXlsx = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leader statistics");
    ws.addRow([`Workspace — ${title}, ${fmtDate(from)} – ${fmtDate(to)}`]).getCell(1).font = { bold: true, size: 13, color: { argb: "FF4C5FD5" } };
    ws.addRow([]);
    const head = ws.addRow(["Leader", "Team", "Hours worked", "Benchmark hours", "Difference", "Tasks completed", "Task hours", "Event hours", "Meetings attended", "Meeting attendance", "Events attended", "Event attendance", "Debriefs submitted"]);
    head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4C5FD5" } }; });
    rows.forEach(({ m, p, diff, submitted }) =>
      ws.addRow([
        m.name, m.team || "", p.hoursWorked, p.benchmark, diff, p.tasks.length, round1(p.taskMinutes / 60), p.eventHours,
        `${p.meetingsAttended}/${p.meetingsInvited}`, pct(p.meetingsAttended, p.meetingsInvited),
        `${p.eventsAttended}/${p.eventsInvited}`, pct(p.eventsAttended, p.eventsInvited), submitted,
      ])
    );
    ws.columns.forEach((c, i) => { c.width = i === 0 ? 20 : 14; });
    const buf = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `app-leader-stats-${from}-to-${to}.xlsx`);
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ ...sectionLabel, marginBottom: 0, flex: 1, minWidth: 160 }}>{title}</div>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ ...inputStyle, width: 150, padding: "6px 8px", fontSize: 12.5 }} />
        <span style={{ fontSize: 12, color: C.inkSoft, alignSelf: "center" }}>to</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ ...inputStyle, width: 150, padding: "6px 8px", fontSize: 12.5 }} />
        <button onClick={() => exportXlsx()} style={{ ...btn(C.accent), padding: "7px 12px", fontSize: 12 }}>⭳ Excel</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Leader", "Hours vs benchmark", "Tasks", "Meeting attendance", "Event attendance", "Debriefs"].map((h) => (
                <th key={h} style={{ textAlign: "left", fontFamily: mono, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: C.inkSoft, fontWeight: 500, padding: "6px 8px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, p, diff, submitted }) => (
              <tr key={m.id}>
                <td style={td}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Avatar m={m} size={22} />{m.name}{m.team ? <span style={{ color: C.inkSoft, fontSize: 11.5 }}>· {m.team}</span> : null}</span></td>
                <td style={td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 90, height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, p.benchmark ? (p.hoursWorked / p.benchmark) * 100 : 0)}%`, height: "100%", background: diff >= 0 ? "#1F6F54" : C.amber }} />
                    </div>
                    <span><b>{p.hoursWorked}h</b> / {p.benchmark}h</span>
                    <span style={{ fontSize: 11.5, color: diff >= 0 ? "#1F6F54" : C.red }}>{diff >= 0 ? `+${diff}` : diff}h</span>
                  </div>
                </td>
                <td style={td}>{p.tasks.length}</td>
                <td style={td}>{pct(p.meetingsAttended, p.meetingsInvited)} <span style={{ color: C.inkSoft, fontSize: 11.5 }}>({p.meetingsAttended}/{p.meetingsInvited})</span></td>
                <td style={td}>{pct(p.eventsAttended, p.eventsInvited)} <span style={{ color: C.inkSoft, fontSize: 11.5 }}>({p.eventsAttended}/{p.eventsInvited})</span></td>
                <td style={td}>{submitted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Build + submit a debrief for a chosen period
// ------------------------------------------------------------------
function DebriefBuilder({ me, completions, calEvents, attendees, settings, eventNames, defaultFrom, note, reload, onClose }) {
  const [from, setFrom] = useState(defaultFrom > isoDate(new Date()) ? isoDate(new Date()) : defaultFrom);
  const [to, setTo] = useState(isoDate(new Date()));
  const [reflection, setReflection] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // "Log a task I did" — self-assigned and completed in one go
  const [logOpen, setLogOpen] = useState(false);
  const [lt, setLt] = useState({ title: "", event: eventNames.find((n) => n.toLowerCase() === "general") || eventNames[0] || "", hours: "", minutes: "" });

  const p = useMemo(
    () => memberPerformance({ memberId: me.id, from, to, completions, calEvents, attendees, benchmarkPerWeek: settings.benchmark_hours_per_week }),
    [me.id, from, to, completions, calEvents, attendees, settings.benchmark_hours_per_week]
  );
  const diff = round1(p.hoursWorked - p.benchmark);
  const ltMinutes = (parseInt(lt.hours || "0", 10) || 0) * 60 + (parseInt(lt.minutes || "0", 10) || 0);

  const logTask = async () => {
    if (!lt.title.trim() || !lt.event || ltMinutes <= 0) return;
    setBusy(true);
    const today = isoDate(new Date());
    const { error } = await supabase.from("tasks").insert({
      title: lt.title.trim(), event: lt.event,
      assignee: me.id, assignees: [me.id], assigner: me.id,
      priority: "normal", due: today, col: "done",
      minutes_spent: ltMinutes, completion_notes: "Self-logged from a debrief",
    });
    if (error) {
      setBusy(false);
      return note("Couldn't log that task — try again", true);
    }
    await reload();
    if (to < today) setTo(today); // it's recorded as completed today
    setBusy(false);
    setLt((x) => ({ ...x, title: "", hours: "", minutes: "" }));
    setLogOpen(false);
    note("Task logged ✓");
  };

  const submit = async () => {
    setConfirm(false);
    setBusy(true);
    const { error } = await supabase.from("debriefs").insert({
      member_id: me.id,
      period_start: from,
      period_end: to,
      task_minutes: p.taskMinutes,
      event_hours: p.eventHours,
      tasks_completed: p.tasks.length,
      meetings_invited: p.meetingsInvited,
      meetings_attended: p.meetingsAttended,
      events_invited: p.eventsInvited,
      events_attended: p.eventsAttended,
      benchmark_hours: p.benchmark,
      reflection: reflection.trim() || null,
      items: {
        tasks: p.tasks.map((r) => ({ title: r.title, event: r.event, completed_at: r.completed_at, minutes: r.minutes_worked })),
        events: p.attendedEvents.map((a) => ({ title: a.ev.title, kind: a.ev.kind, starts_at: a.ev.starts_at, hours: round1(eventHours(a.ev)) })),
      },
    });
    setBusy(false);
    if (error) return note("Couldn't submit the debrief — try again", true);
    await reload();
    note("Debrief submitted ✓");
    onClose();
  };

  const thStyle = { textAlign: "left", fontFamily: mono, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: C.inkSoft, fontWeight: 500, padding: "5px 6px", borderBottom: `1px solid ${C.line}` };
  const cell = { padding: "6px 6px", borderBottom: `1px solid ${C.line}`, fontSize: 12.5 };

  return (
    <Modal onClose={onClose} maxWidth={640}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.ink }}>New debrief — {me.name}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>From</label>
          <input style={inputStyle} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>To</label>
          <input style={inputStyle} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 14 }}>
        {[
          { n: `${p.hoursWorked}h`, l: "worked", c: diff >= 0 ? "#1F6F54" : C.red },
          { n: `${p.benchmark}h`, l: "benchmark" },
          { n: pct(p.meetingsAttended, p.meetingsInvited), l: "meetings" },
          { n: pct(p.eventsAttended, p.eventsInvited), l: "events" },
        ].map((t) => (
          <div key={t.l} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: t.c || C.ink }}>{t.n}</div>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", marginTop: 16 }}>
        <div style={{ ...sectionLabel, marginBottom: 6, flex: 1 }}>Tasks completed · {p.tasks.length} · {fmtMinutes(p.taskMinutes)}</div>
        <button onClick={() => setLogOpen((v) => !v)} style={{ background: "none", border: "none", color: C.accent, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>
          {logOpen ? "Cancel" : "+ Log a task I did"}
        </button>
      </div>
      {logOpen && (
        <div style={{ background: C.accentSoft, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 6 }}>
            Adds a task assigned to you, marked done today with the time you spent — it shows on the board and in stats like any other.
          </div>
          <input style={inputStyle} value={lt.title} onChange={(e) => setLt((x) => ({ ...x, title: e.target.value }))} placeholder="What did you do?" />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <select style={{ ...inputStyle, flex: 2 }} value={lt.event} onChange={(e) => setLt((x) => ({ ...x, event: e.target.value }))}>
              {eventNames.map((n) => <option key={n}>{n}</option>)}
            </select>
            <input style={{ ...inputStyle, flex: 1 }} type="number" min="0" value={lt.hours} onChange={(e) => setLt((x) => ({ ...x, hours: e.target.value }))} placeholder="h" aria-label="Hours" />
            <input style={{ ...inputStyle, flex: 1 }} type="number" min="0" max="59" value={lt.minutes} onChange={(e) => setLt((x) => ({ ...x, minutes: e.target.value }))} placeholder="min" aria-label="Minutes" />
            <button onClick={logTask} disabled={busy || !lt.title.trim() || ltMinutes <= 0} style={{ ...btn(C.accent, true), opacity: lt.title.trim() && ltMinutes > 0 ? 1 : 0.5 }}>Add</button>
          </div>
        </div>
      )}
      {p.tasks.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.inkSoft }}>No completed tasks in this period.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={thStyle}>Task</th><th style={thStyle}>Event</th><th style={thStyle}>Completed</th><th style={{ ...thStyle, textAlign: "right" }}>Time</th></tr></thead>
          <tbody>
            {p.tasks.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{r.title}</td>
                <td style={{ ...cell, color: C.inkSoft }}>{r.event}</td>
                <td style={{ ...cell, color: C.inkSoft, whiteSpace: "nowrap" }}>{fmtDate(r.completed_at)}</td>
                <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{fmtMinutes(r.minutes_worked)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ ...sectionLabel, marginTop: 16, marginBottom: 6 }}>Events & meetings attended · {p.attendedEvents.length} · {p.eventHours}h</div>
      {p.attendedEvents.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.inkSoft }}>No recorded attendance in this period.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {p.attendedEvents.map((a) => (
              <tr key={a.event_id}>
                <td style={cell}>{a.ev.title}</td>
                <td style={{ ...cell, color: C.inkSoft }}>{eventKind(a.ev.kind).label}</td>
                <td style={{ ...cell, color: C.inkSoft, whiteSpace: "nowrap" }}>{fmtDate(a.ev.starts_at)}</td>
                <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{round1(eventHours(a.ev))}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <label style={labelStyle}>Reflection (optional)</label>
      <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="What went well, what got in the way, what's next…" />

      {confirm ? (
        <div style={{ background: C.accentSoft, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: "10px 12px", marginTop: 14 }}>
          <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>
            Submit this debrief for {fmtDate(from)} – {fmtDate(to)} ({p.hoursWorked}h of {p.benchmark}h)? Execs will see it.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} disabled={busy} style={btn(C.accent, true)}>Yes, submit</button>
            <button onClick={() => setConfirm(false)} style={btn(C.inkSoft)}>Back</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{ ...btn(C.inkSoft), flex: 1 }}>Cancel</button>
          <button onClick={() => setConfirm(true)} disabled={busy} style={{ ...btn(C.accent, true), flex: 2 }}>Submit debrief</button>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------
// Read a submitted debrief (snapshot taken at submission time)
// ------------------------------------------------------------------
function DebriefView({ d, members, onClose }) {
  const m = member(members, d.member_id);
  const hours = round1(d.task_minutes / 60 + Number(d.event_hours));
  const items = d.items || {};
  const cell = { padding: "6px 6px", borderBottom: `1px solid ${C.line}`, fontSize: 12.5 };
  return (
    <Modal onClose={onClose} maxWidth={600}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar m={m} size={34} />
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.ink }}>{m.name}'s debrief</h2>
          <div style={{ fontSize: 12.5, color: C.inkSoft }}>{fmtDate(d.period_start)} – {fmtDate(d.period_end)} · submitted {fmtDate(d.submitted_at)}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 14 }}>
        {[
          { n: `${hours}h`, l: "worked", c: hours >= Number(d.benchmark_hours) ? "#1F6F54" : C.red },
          { n: `${round1(Number(d.benchmark_hours))}h`, l: "benchmark" },
          { n: pct(d.meetings_attended, d.meetings_invited), l: "meetings" },
          { n: pct(d.events_attended, d.events_invited), l: "events" },
        ].map((t) => (
          <div key={t.l} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: t.c || C.ink }}>{t.n}</div>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.l}</div>
          </div>
        ))}
      </div>
      <div style={{ ...sectionLabel, marginTop: 16, marginBottom: 6 }}>Tasks · {d.tasks_completed} · {fmtMinutes(d.task_minutes)}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {(items.tasks || []).map((t, i) => (
            <tr key={i}>
              <td style={cell}>{t.title}</td>
              <td style={{ ...cell, color: C.inkSoft }}>{t.event}</td>
              <td style={{ ...cell, color: C.inkSoft }}>{fmtDate(t.completed_at)}</td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{fmtMinutes(t.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ ...sectionLabel, marginTop: 16, marginBottom: 6 }}>Events attended · {round1(Number(d.event_hours))}h</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {(items.events || []).map((e, i) => (
            <tr key={i}>
              <td style={cell}>{e.title}</td>
              <td style={{ ...cell, color: C.inkSoft }}>{eventKind(e.kind).label}</td>
              <td style={{ ...cell, color: C.inkSoft }}>{fmtDate(e.starts_at)}</td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{e.hours}h</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.reflection && (
        <>
          <div style={{ ...sectionLabel, marginTop: 16, marginBottom: 6 }}>Reflection</div>
          <div style={{ fontSize: 13, color: C.ink, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{d.reflection}</div>
        </>
      )}
      <button onClick={onClose} style={{ ...btn(C.inkSoft), width: "100%", marginTop: 18 }}>Close</button>
    </Modal>
  );
}
