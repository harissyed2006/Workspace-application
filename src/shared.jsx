// Shared design tokens, helpers and small UI pieces used across the app.

// ---------- Design tokens  ----------
export const C = {
  bg: "#F5F6F8",         // cool paper
  surface: "#FFFFFF",
  ink: "#1E2230",        // deep ink
  inkSoft: "#646B7A",    // slate grey
  line: "#DFE2E8",
  accent: "#4C5FD5",     // brand indigo
  accentSoft: "#ECEEFB",
  amber: "#C8860A",
  amberSoft: "#FBF1DC",
  red: "#C2402E",
  redSoft: "#F9E7E3",
  blue: "#2B5B8C",
  blueSoft: "#E4EDF5",
};

export const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
export const sans = "'Avenir Next', 'Segoe UI', system-ui, -apple-system, sans-serif";

export const PRIORITIES = {
  urgent: { label: "Urgent", color: C.red, soft: C.redSoft },
  normal: { label: "Normal", color: C.blue, soft: C.blueSoft },
  low: { label: "Low", color: C.inkSoft, soft: "#ECEEF2" },
};

export const COLUMNS = [
  { id: "todo", label: "To Do" },
  { id: "doing", label: "In Progress" },
  { id: "done", label: "Done" },
];

// Recurring tasks: completing one spawns the next occurrence (DB trigger)
export const REPEATS = [
  { id: "", label: "Doesn't repeat" },
  { id: "daily", label: "Every day" },
  { id: "weekly", label: "Every week" },
  { id: "fortnightly", label: "Every fortnight" },
  { id: "monthly", label: "Every month" },
  { id: "quarterly", label: "Every 3 months" },
  { id: "yearly", label: "Every year" },
];
export const repeatLabel = (id) => (REPEATS.find((r) => r.id === id) || {}).label || "";

// ---------- Team + roles ----------
// Members and roles now live in the database (public.members / public.roles)
// and are managed by owners from the Team panel. The `roles` table maps a
// login email to 'owner' or 'admin'; anyone not listed is a regular member.
// Note: role checks in the UI only show/hide buttons — the real enforcement
// lives in the database policies (is_board_owner / is_board_admin in SQL).
export const MEMBER_COLORS = [
  "#4C5FD5", "#2B5B8C", "#8C4B2B", "#A83E5E", "#3E7A8C",
  "#1F6F54", "#7A6A2E", "#4E5E9E", "#9C6B1F", "#5E7A2E",
];

// ---------- App logo: a small kanban mark ----------
export const Logo = ({ size = 46 }) => (
  <svg viewBox="0 0 48 48" width={size} height={size} aria-label="Workspace logo">
    <rect width="48" height="48" rx="12" fill={C.accent} />
    <rect x="10" y="11" width="7" height="26" rx="2.5" fill="#fff" />
    <rect x="20.5" y="11" width="7" height="18" rx="2.5" fill="#fff" opacity="0.8" />
    <rect x="31" y="11" width="7" height="11" rx="2.5" fill="#fff" opacity="0.6" />
  </svg>
);

// ---------- Helpers ----------
// All member lookups take the members list loaded from the database.
export const member = (members, id) =>
  members.find((m) => m.id === id) ||
  { id, name: id || "?", initials: "?", color: "#8A8F9C" };
export const memberForEmail = (members, email) =>
  members.find((m) => (m.email || "") === (email || "").toLowerCase()) || null;
export const memberNameForEmail = (members, email) => {
  const m = memberForEmail(members, email);
  return m ? m.name : email || "unknown";
};
export const roleForEmail = (roles, email) =>
  (roles.find((r) => r.email === (email || "").toLowerCase()) || {}).role || null;
// Tasks/completions may predate multi-assignee: fall back to the legacy
// single-assignee column when the array is missing/empty.
export const taskAssignees = (t) =>
  t.assignees && t.assignees.length ? t.assignees : t.assignee ? [t.assignee] : [];
export const today = () => new Date(new Date().toDateString());
export const daysUntil = (due) => Math.ceil((new Date(due) - today()) / 86400000);
export const plusDays = (n) => {
  const t = new Date();
  t.setDate(t.getDate() + n);
  return t.toISOString().slice(0, 10);
};

export function dueMeta(task) {
  if (task.col === "done") return { text: "Done", color: C.inkSoft, soft: "transparent" };
  const n = daysUntil(task.due);
  if (n < 0) return { text: `Overdue ${-n}d`, color: C.red, soft: C.redSoft };
  if (n === 0) return { text: "Due today", color: C.red, soft: C.redSoft };
  if (n <= 3) return { text: `Due in ${n}d`, color: C.amber, soft: C.amberSoft };
  return {
    text: new Date(task.due).toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
    color: C.inkSoft,
    soft: "transparent",
  };
}

export const Avatar = ({ m, size = 24 }) => (
  <span
    title={m.name}
    style={{
      width: size, height: size, borderRadius: "50%",
      background: m.color, color: "#fff",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, fontFamily: sans, flexShrink: 0,
    }}
  >
    {m.initials}
  </span>
);

export const Tag = ({ text }) => (
  <span
    style={{
      fontFamily: mono, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase",
      background: C.accentSoft, color: C.accent, padding: "2px 7px",
      borderRadius: 3, border: `1px solid ${C.accent}22`,
    }}
  >
    {text}
  </span>
);
// ---------- Roles ----------
// roles.role → what the team calls it. Execs = owner + admin.
export const ROLE_LABELS = { owner: "Owner", admin: "Exec", team_admin: "Team admin" };
export const roleLabel = (role) => ROLE_LABELS[role] || "Leader";

// ---------- Small formatting helpers ----------
export const isoDate = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = (d) =>
  new Date(d).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const fmtMinutes = (mins) => {
  if (mins === null || mins === undefined || mins === "") return "—";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};
export const round1 = (n) => Math.round(n * 10) / 10;
export const saveBlob = (blob, filename) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- Shared modal + control styles ----------
export const Modal = ({ onClose, maxWidth = 460, z = 50, children }) => (
  <div
    onClick={onClose}
    className="app-overlay"
    style={{ position: "fixed", inset: 0, background: "rgba(30,34,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: z }}
  >
    <div onClick={(e) => e.stopPropagation()} className="app-modal" style={{ background: C.surface, borderRadius: 12, padding: 22, width: "100%", maxWidth, fontFamily: sans, maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box" }}>
      {children}
    </div>
  </div>
);
export const inputStyle = {
  width: "100%", padding: "9px 10px", borderRadius: 7, border: `1px solid ${C.line}`,
  fontSize: 13.5, fontFamily: sans, color: C.ink, background: "#fff", boxSizing: "border-box",
};
export const labelStyle = { fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, display: "block", marginBottom: 5, marginTop: 12 };
export const btn = (color = C.accent, solid = false) => ({
  background: solid ? color : "transparent", color: solid ? "#fff" : color,
  border: solid ? "none" : `1px solid ${color}55`, borderRadius: 8,
  padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: sans,
});
export const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" };
export const sectionLabel = { fontFamily: mono, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10 };

// ---------- Scheduled events (calendar_events) ----------
// Who may create each kind is enforced in SQL (can_create_event_kind); the
// `who` field here only decides which options the form offers.
export const EVENT_KINDS = [
  { id: "major_event", label: "Major event", group: "event", who: "exec", color: "#4C5FD5" },
  { id: "minor_event", label: "Minor event", group: "event", who: "all", color: "#2B5B8C" },
  { id: "club_event", label: "Club event", group: "event", who: "all", color: "#1F6F54" },
  { id: "team_meeting", label: "Team meeting", group: "meeting", who: "team_admin", color: "#9C6B1F" },
  { id: "leaders_meeting", label: "Leaders meeting", group: "meeting", who: "exec", color: "#A83E5E" },
];
export const eventKind = (id) => EVENT_KINDS.find((k) => k.id === id) || EVENT_KINDS[1];
export const canCreateKind = (kind, { admin, teamAdmin }) => {
  const k = eventKind(kind);
  return k.who === "all" || (k.who === "team_admin" ? teamAdmin : admin);
};
export const eventHours = (ev) =>
  ev.ends_at ? Math.max(0, (new Date(ev.ends_at) - new Date(ev.starts_at)) / 3600000) : 0;

// Google Calendar "add event" link — no API or account linking needed.
export const googleCalendarUrl = (ev) => {
  const z = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = ev.ends_at || new Date(new Date(ev.starts_at).getTime() + 3600000);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${z(ev.starts_at)}/${z(end)}`,
    details: ev.description || "",
    location: ev.location || "",
  });
  return `https://calendar.google.com/calendar/render?${q}`;
};

// ---------- Performance maths (home page + debriefs) ----------
// Hours worked = minutes entered when completing tasks (each assignee gets
// the task's full minutes) + the length of events/meetings they attended.
// Attendance only counts invitations where attendance was recorded.
export function memberPerformance({ memberId, from, to, completions, calEvents, attendees, benchmarkPerWeek }) {
  const fromT = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
  const toT = to ? new Date(to + "T23:59:59").getTime() : Infinity;
  const inRange = (d) => {
    const t = new Date(d).getTime();
    return t >= fromT && t <= toT;
  };
  const tasks = completions
    .filter((r) => !r.reopened && taskAssignees(r).includes(memberId) && inRange(r.completed_at))
    .sort((a, b) => (a.completed_at < b.completed_at ? -1 : 1));
  const taskMinutes = tasks.reduce((s, r) => s + (r.minutes_worked || 0), 0);

  const byId = new Map(calEvents.map((e) => [e.id, e]));
  const mine = attendees
    .filter((a) => a.member_id === memberId && byId.has(a.event_id))
    .map((a) => ({ ...a, ev: byId.get(a.event_id) }))
    .filter((a) => inRange(a.ev.starts_at) && new Date(a.ev.starts_at) <= new Date());
  const recorded = mine.filter((a) => a.attended !== null && a.attended !== undefined);
  const group = (g) => recorded.filter((a) => eventKind(a.ev.kind).group === g);
  const meetings = group("meeting"), events = group("event");
  const attendedEvents = recorded.filter((a) => a.attended);
  const eventHoursTotal = attendedEvents.reduce((s, a) => s + eventHours(a.ev), 0);

  const days = from && to ? Math.max(1, Math.round((toT - fromT) / 86400000)) : 0;
  const benchmark = round1((days / 7) * (Number(benchmarkPerWeek) || 0));
  const hoursWorked = round1(taskMinutes / 60 + eventHoursTotal);
  return {
    tasks,
    taskMinutes,
    attendedEvents,
    eventHours: round1(eventHoursTotal),
    hoursWorked,
    benchmark,
    meetingsInvited: meetings.length,
    meetingsAttended: meetings.filter((a) => a.attended).length,
    eventsInvited: events.length,
    eventsAttended: events.filter((a) => a.attended).length,
  };
}
export const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");
