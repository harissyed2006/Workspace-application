import { useState, useMemo } from "react";
import { supabase } from "./supabase.js";
import {
  C, mono, sans, Avatar, member, EVENT_KINDS, eventKind, canCreateKind, fmtDateTime,
  isoDate, googleCalendarUrl, eventHours, card, sectionLabel, btn, inputStyle, labelStyle, Modal,
} from "./shared.jsx";

const pad = (n) => String(n).padStart(2, "0");
const timeOf = (d) => `${pad(new Date(d).getHours())}:${pad(new Date(d).getMinutes())}`;

// ==================================================================
// Events — schedule upcoming events/meetings, RSVP, log past ones with
// attendance. Who can create which kind is enforced in SQL too.
// ==================================================================
export default function EventsPage({ me, admin, teamAdmin, members, allMembers, calEvents, attendees, reloadCalendar, note }) {
  const [editing, setEditing] = useState(null); // { mode: 'schedule'|'log', event? }
  const [kindFilter, setKindFilter] = useState([]);
  const [showPast, setShowPast] = useState(false);
  const [declining, setDeclining] = useState(null); // event id being declined
  const [reason, setReason] = useState("");

  const now = new Date();
  const attendeesOf = (id) => attendees.filter((a) => a.event_id === id);
  const myRsvp = (id) => attendees.find((a) => a.event_id === id && a.member_id === me.id);
  const canManage = (ev) => admin || ev.created_by_email === (me.email || "").toLowerCase();

  const shown = useMemo(
    () => calEvents.filter((e) => kindFilter.length === 0 || kindFilter.includes(e.kind)),
    [calEvents, kindFilter]
  );
  const upcoming = shown.filter((e) => new Date(e.starts_at) >= now).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  const past = shown.filter((e) => new Date(e.starts_at) < now).sort((a, b) => (a.starts_at > b.starts_at ? -1 : 1));
  const waiting = upcoming.filter((e) => myRsvp(e.id)?.rsvp === "pending");

  const rsvp = async (ev, answer, why = null) => {
    const { error } = await supabase
      .from("calendar_event_attendees")
      .update({ rsvp: answer, rsvp_reason: answer === "no" ? why : null })
      .eq("event_id", ev.id)
      .eq("member_id", me.id);
    if (error) return note("Couldn't save your reply — try again", true);
    setDeclining(null);
    setReason("");
    await reloadCalendar();
    note(answer === "yes" ? "Marked as going ✓" : "Reply sent ✓");
  };

  const kindChip = (k, on, onClick) => (
    <button
      key={k.id}
      onClick={onClick}
      style={{
        fontFamily: mono, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase",
        padding: "6px 12px", borderRadius: 20, cursor: "pointer",
        background: on ? C.ink : C.surface, color: on ? "#fff" : C.inkSoft,
        border: `1px solid ${on ? C.ink : C.line}`, display: "inline-flex", alignItems: "center", gap: 6,
      }}
    >
      {k.color && <span style={{ width: 7, height: 7, borderRadius: "50%", background: k.color }} />}
      {k.label}
    </button>
  );

  // Called as a function (not <EventRow/>) so the decline-reason input keeps focus
  const eventRow = (ev) => {
    const k = eventKind(ev.kind);
    const list = attendeesOf(ev.id);
    const mine = myRsvp(ev.id);
    const isPast = new Date(ev.starts_at) < now;
    const recorded = list.filter((a) => a.attended !== null && a.attended !== undefined);
    const going = list.filter((a) => a.rsvp === "yes").length;
    const notGoing = list.filter((a) => a.rsvp === "no");
    const hrs = eventHours(ev);
    return (
      <div key={ev.id} className="app-card" style={{ ...card, padding: "12px 14px", borderLeft: `4px solid ${k.color}`, marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 5 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: "#fff", background: k.color, padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>{k.label}</span>
              {ev.private && (
                <span title="Only execs can see this" style={{ fontFamily: mono, fontSize: 10, color: "#fff", background: C.ink, padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Private</span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{ev.title}</div>
            <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3 }}>
              {fmtDateTime(ev.starts_at)}
              {ev.ends_at ? ` – ${new Date(ev.ends_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}` : ""}
              {hrs ? ` · ${Math.round(hrs * 10) / 10}h` : ""}
              {ev.location ? ` · ${ev.location}` : ""}
            </div>
            {ev.description && <div style={{ fontSize: 12.5, color: C.ink, marginTop: 6, whiteSpace: "pre-wrap" }}>{ev.description}</div>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ display: "inline-flex" }}>
              {list.slice(0, 6).map((a, i) => (
                <span key={a.member_id} style={{ marginLeft: i === 0 ? 0 : -7, border: `2px solid ${C.surface}`, borderRadius: "50%", display: "inline-flex", opacity: isPast ? (a.attended ? 1 : 0.35) : a.rsvp === "no" ? 0.35 : 1 }}>
                  <Avatar m={member(allMembers, a.member_id)} size={24} />
                </span>
              ))}
              {list.length > 6 && <span style={{ fontSize: 11.5, color: C.inkSoft, marginLeft: 6, alignSelf: "center" }}>+{list.length - 6}</span>}
            </span>
            <span style={{ fontSize: 11.5, color: C.inkSoft }}>
              {list.length === 0
                ? "Nobody invited"
                : isPast
                  ? recorded.length
                    ? `${recorded.filter((a) => a.attended).length} of ${list.length} attended`
                    : "Attendance not recorded"
                  : `${going} going · ${notGoing.length} can't · ${list.length - going - notGoing.length} no reply`}
            </span>
          </div>
        </div>

        {/* Reasons people gave for not coming — visible to the organiser */}
        {canManage(ev) && notGoing.some((a) => a.rsvp_reason) && (
          <div style={{ marginTop: 8, background: C.bg, borderRadius: 7, padding: "6px 10px", fontSize: 12, color: C.inkSoft }}>
            {notGoing.filter((a) => a.rsvp_reason).map((a) => (
              <div key={a.member_id}><b style={{ color: C.ink }}>{member(allMembers, a.member_id).name}</b> can't come: {a.rsvp_reason}</div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          {mine && !isPast && (
            declining === ev.id ? (
              <>
                <input
                  style={{ ...inputStyle, flex: 1, minWidth: 180, padding: "7px 9px", fontSize: 12.5 }}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && reason.trim() && rsvp(ev, "no", reason.trim())}
                  placeholder="Why can't you make it?"
                  autoFocus
                />
                <button onClick={() => reason.trim() && rsvp(ev, "no", reason.trim())} disabled={!reason.trim()} style={{ ...btn(C.red, true), padding: "7px 12px", fontSize: 12, opacity: reason.trim() ? 1 : 0.5 }}>Send</button>
                <button onClick={() => setDeclining(null)} style={{ ...btn(C.inkSoft), padding: "7px 10px", fontSize: 12 }}>✕</button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 12, color: C.inkSoft }}>Your reply:</span>
                <button onClick={() => rsvp(ev, "yes")} style={{ ...btn("#1F6F54", mine.rsvp === "yes"), padding: "6px 12px", fontSize: 12 }}>✓ Going</button>
                <button onClick={() => { setDeclining(ev.id); setReason(mine.rsvp_reason || ""); }} style={{ ...btn(C.red, mine.rsvp === "no"), padding: "6px 12px", fontSize: 12 }}>✕ Can't go</button>
                {mine.rsvp === "no" && mine.rsvp_reason && <span style={{ fontSize: 12, color: C.inkSoft }}>“{mine.rsvp_reason}”</span>}
              </>
            )
          )}
          <div style={{ flex: 1 }} />
          {!isPast && (
            <a href={googleCalendarUrl(ev)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>
              + Google Calendar
            </a>
          )}
          {canManage(ev) && (
            <button onClick={() => setEditing({ mode: isPast ? "log" : "schedule", event: ev })} style={{ ...btn(C.accent), padding: "6px 12px", fontSize: 12 }}>
              {isPast && recorded.length === 0 && list.length ? "Record attendance" : "Edit"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        {kindChip({ id: "all", label: "All" }, kindFilter.length === 0, () => setKindFilter([]))}
        {EVENT_KINDS.map((k) =>
          kindChip(k, kindFilter.includes(k.id), () =>
            setKindFilter((fs) => (fs.includes(k.id) ? fs.filter((x) => x !== k.id) : [...fs, k.id]))
          )
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditing({ mode: "log" })} style={btn(C.accent)}>Log a past event</button>
        <button onClick={() => setEditing({ mode: "schedule" })} style={btn(C.accent, true)}>+ Schedule event</button>
      </div>

      {waiting.length > 0 && (
        <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: C.ink }}>
          <b>{waiting.length}</b> invitation{waiting.length === 1 ? "" : "s"} waiting for your reply — let the organiser know if you can come.
        </div>
      )}

      <div style={sectionLabel}>Upcoming · {upcoming.length}</div>
      {upcoming.length === 0 && (
        <div style={{ ...card, fontSize: 13, color: C.inkSoft, marginBottom: 10 }}>Nothing scheduled yet.</div>
      )}
      {upcoming.map(eventRow)}

      <button
        onClick={() => setShowPast((v) => !v)}
        style={{ ...sectionLabel, background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 18 }}
      >
        {showPast ? "▾" : "▸"} Past & logged · {past.length}
      </button>
      {showPast && past.map(eventRow)}

      {editing && (
        <EventModal
          mode={editing.mode}
          event={editing.event}
          existing={editing.event ? attendeesOf(editing.event.id) : []}
          me={me}
          admin={admin}
          teamAdmin={teamAdmin}
          members={members}
          note={note}
          reloadCalendar={reloadCalendar}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Schedule / log / edit an event
// ------------------------------------------------------------------
function EventModal({ mode, event, existing, me, admin, teamAdmin, members, note, reloadCalendar, onClose }) {
  const allowed = EVENT_KINDS.filter((k) => canCreateKind(k.id, { admin, teamAdmin }) || k.id === event?.kind);
  const logging = mode === "log";
  const start = event ? new Date(event.starts_at) : null;
  const [f, setF] = useState({
    title: event?.title || "",
    kind: event?.kind || allowed[allowed.length > 1 ? 1 : 0]?.id || "minor_event",
    date: start ? isoDate(start) : logging ? isoDate(new Date()) : "",
    time: start ? timeOf(start) : "18:00",
    endTime: event?.ends_at ? timeOf(event.ends_at) : "",
    location: event?.location || "",
    description: event?.description || "",
    private: !!event?.private,
  });
  const [invited, setInvited] = useState(existing.map((a) => a.member_id));
  const [attended, setAttended] = useState(
    Object.fromEntries(existing.map((a) => [a.member_id, a.attended ?? (logging ? a.rsvp !== "no" : null)]))
  );
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const startsAt = f.date && f.time ? new Date(`${f.date}T${f.time}`) : null;
  const endsAt = f.date && f.endTime ? new Date(`${f.date}T${f.endTime}`) : null;
  const isFuture = startsAt && startsAt > new Date();
  const problems = [
    !f.title.trim() && "Give it a name",
    !startsAt && "Pick a date and time",
    endsAt && startsAt && endsAt <= startsAt && "End time must be after the start",
    logging && isFuture && "A logged event must be in the past — use Schedule instead",
  ].filter(Boolean);

  const toggleInvite = (id) => {
    setInvited((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
    setAttended((m) => ({ ...m, [id]: m[id] ?? (logging ? true : null) }));
  };
  const setMany = (ids) => {
    setInvited(ids);
    setAttended((m) => Object.fromEntries(ids.map((id) => [id, m[id] ?? (logging ? true : null)])));
  };
  const myTeam = members.find((m) => m.id === me.id)?.team;

  const save = async () => {
    if (problems.length) return;
    setBusy(true);
    const row = {
      title: f.title.trim(),
      kind: f.kind,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      location: f.location.trim() || null,
      description: f.description.trim() || null,
      private: admin ? f.private : false,
    };
    let id = event?.id;
    if (id) {
      const { error } = await supabase.from("calendar_events").update(row).eq("id", id);
      if (error) { setBusy(false); return note("Couldn't save — you may not have permission for this event type", true); }
    } else {
      const { data, error } = await supabase
        .from("calendar_events")
        .insert({ ...row, created_by: me.id !== "?" ? me.id : null })
        .select()
        .single();
      if (error) { setBusy(false); return note("Couldn't create — you may not have permission for this event type", true); }
      id = data.id;
    }
    // Sync the invite list, then attendance (when logging / recording)
    const before = existing.map((a) => a.member_id);
    const add = invited.filter((x) => !before.includes(x));
    const remove = before.filter((x) => !invited.includes(x));
    const results = [];
    if (add.length) {
      results.push(await supabase.from("calendar_event_attendees").insert(
        add.map((member_id) => ({ event_id: id, member_id, attended: logging ? !!attended[member_id] : null }))
      ));
    }
    if (remove.length) {
      results.push(await supabase.from("calendar_event_attendees").delete().eq("event_id", id).in("member_id", remove));
    }
    if (logging) {
      for (const mid of invited.filter((x) => before.includes(x))) {
        results.push(await supabase.from("calendar_event_attendees")
          .update({ attended: !!attended[mid] }).eq("event_id", id).eq("member_id", mid));
      }
    }
    setBusy(false);
    await reloadCalendar();
    if (results.some((r) => r.error)) note("Event saved, but some invitees didn't update", true);
    else note(event ? "Event updated ✓" : logging ? "Event logged ✓" : "Event scheduled ✓");
    onClose();
  };

  const destroy = async () => {
    setBusy(true);
    const { error } = await supabase.from("calendar_events").delete().eq("id", event.id);
    setBusy(false);
    if (error) return note("Delete failed — try again", true);
    await reloadCalendar();
    note("Event deleted ✓");
    onClose();
  };

  return (
    <Modal onClose={onClose} maxWidth={520}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.ink }}>
        {event ? (logging ? "Past event & attendance" : "Edit event") : logging ? "Log a past event" : "Schedule an event"}
      </h2>
      <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>
        {logging
          ? "Record an event that already happened — who was meant to come and who actually attended. This feeds attendance stats and debriefs."
          : "Invited people see it on their Events and Home pages and can reply whether they can come."}
      </p>

      <label style={labelStyle}>Name</label>
      <input style={inputStyle} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Term 4 leaders meeting" autoFocus />

      <label style={labelStyle}>Type</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {EVENT_KINDS.map((k) => {
          const ok = allowed.some((a) => a.id === k.id);
          const on = f.kind === k.id;
          return (
            <button
              key={k.id}
              onClick={() => ok && set("kind", k.id)}
              disabled={!ok}
              title={ok ? "" : k.who === "exec" ? "Only execs can create this" : "Only team admins and execs can create this"}
              style={{
                padding: "6px 11px", borderRadius: 16, fontSize: 12.5, fontWeight: 600, fontFamily: sans,
                cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : 0.4,
                background: on ? k.color : "#fff", color: on ? "#fff" : C.inkSoft,
                border: `1px solid ${on ? k.color : C.line}`,
              }}
            >
              {k.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>Date</label>
          <input style={inputStyle} type="date" value={f.date} onChange={(e) => set("date", e.target.value)} max={logging ? isoDate(new Date()) : undefined} />
        </div>
        <div>
          <label style={labelStyle}>Start</label>
          <input style={inputStyle} type="time" value={f.time} onChange={(e) => set("time", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>End</label>
          <input style={inputStyle} type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} />
        </div>
      </div>
      <label style={labelStyle}>Location</label>
      <input style={inputStyle} value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Library, Zoom…" />
      <label style={labelStyle}>Details (optional)</label>
      <textarea style={{ ...inputStyle, minHeight: 54, resize: "vertical" }} value={f.description} onChange={(e) => set("description", e.target.value)} />

      {admin && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer", fontSize: 13, color: C.ink }}>
          <input type="checkbox" checked={f.private} onChange={(e) => set("private", e.target.checked)} style={{ width: 16, height: 16, accentColor: C.accent }} />
          <span><b>Private</b><span style={{ color: C.inkSoft }}> — only execs can see this event</span></span>
        </label>
      )}

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 14 }}>
        <span style={{ ...labelStyle, margin: 0 }}>{logging ? "Who was meant to attend" : "Who's meant to come"}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setMany(members.map((m) => m.id))} style={{ background: "none", border: "none", color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans, padding: 0 }}>Everyone</button>
        {myTeam && (
          <button onClick={() => setMany(members.filter((m) => m.team === myTeam).map((m) => m.id))} style={{ background: "none", border: "none", color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans, padding: 0 }}>
            My team
          </button>
        )}
        <button onClick={() => setMany([])} style={{ background: "none", border: "none", color: C.inkSoft, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans, padding: 0 }}>Clear</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {members.map((m) => {
          const on = invited.includes(m.id);
          return (
            <button
              key={m.id}
              onClick={() => toggleInvite(m.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 6px", borderRadius: 16, cursor: "pointer",
                fontSize: 12.5, fontWeight: 600, fontFamily: sans,
                background: on ? C.accentSoft : "#fff", color: on ? C.accent : C.inkSoft, border: `1px solid ${on ? C.accent : C.line}`,
              }}
            >
              <Avatar m={m} size={20} />{m.name}{on ? " ✓" : ""}
            </button>
          );
        })}
      </div>

      {logging && invited.length > 0 && (
        <>
          <label style={labelStyle}>Attendance — tick who actually came</label>
          <div style={{ background: C.bg, borderRadius: 8, padding: "4px 10px" }}>
            {invited.map((id) => {
              const m = members.find((x) => x.id === id) || member(members, id);
              const rsvpRow = existing.find((a) => a.member_id === id);
              return (
                <label key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!attended[id]} onChange={(e) => setAttended((a) => ({ ...a, [id]: e.target.checked }))} style={{ width: 16, height: 16, accentColor: C.accent }} />
                  <Avatar m={m} size={22} />
                  <span style={{ flex: 1, fontWeight: 600, color: attended[id] ? C.ink : C.inkSoft }}>{m.name}</span>
                  <span style={{ fontSize: 11.5, color: attended[id] ? "#1F6F54" : C.red }}>{attended[id] ? "attended" : "didn't attend"}</span>
                  {rsvpRow?.rsvp === "no" && <span style={{ fontSize: 11, color: C.inkSoft }}>(said no{rsvpRow.rsvp_reason ? `: ${rsvpRow.rsvp_reason}` : ""})</span>}
                </label>
              );
            })}
          </div>
        </>
      )}

      {problems.length > 0 && (f.title || f.date) && (
        <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>{problems[0]}</div>
      )}

      {confirmDelete ? (
        <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 12px", marginTop: 16 }}>
          <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>Delete <b>{event.title}</b> and its invitations and attendance? This can't be undone.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={destroy} disabled={busy} style={btn(C.red, true)}>Yes, delete</button>
            <button onClick={() => setConfirmDelete(false)} style={btn(C.inkSoft)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          {event && <button onClick={() => setConfirmDelete(true)} style={btn(C.red)}>Delete</button>}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btn(C.inkSoft)}>Cancel</button>
          <button
            onClick={save}
            disabled={busy || problems.length > 0}
            style={{ ...btn(C.accent, true), opacity: busy || problems.length ? 0.5 : 1 }}
          >
            {event ? "Save" : logging ? "Log event" : "Schedule"}
          </button>
        </div>
      )}
    </Modal>
  );
}
