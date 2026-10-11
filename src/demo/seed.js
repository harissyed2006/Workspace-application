// Fictional sample data for the public demo. Every person, email and task here
// is made up. Dates are generated relative to "today" so the demo always looks
// current: some tasks are overdue, some due this week, meetings happened
// last week, and so on.

const DAY = 86400000;
const now = () => new Date();
const dayAt = (offset, hour = 9, min = 0) => {
  const d = new Date(now().toDateString());
  d.setDate(d.getDate() + offset);
  d.setHours(hour, min, 0, 0);
  return d;
};
const iso = (offset, hour, min) => dayAt(offset, hour, min).toISOString();
const date = (offset) => {
  const d = dayAt(offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
let n = 0;
const uid = (p) => `${p}-${(++n).toString(16).padStart(4, "0")}-demo`;

export const DEMO_DOMAIN = "demo.example";
const mail = (id) => `${id}@${DEMO_DOMAIN}`;

export function buildSeed() {
  n = 0;
  const members = [
    { id: "alex", name: "Alex Morgan", initials: "AM", color: "#4C5FD5", team: "Leadership", prior_deficit_hours: 0 },
    { id: "priya", name: "Priya Nair", initials: "PN", color: "#2B5B8C", team: "Leadership", prior_deficit_hours: 0 },
    { id: "jordan", name: "Jordan Lee", initials: "JL", color: "#1F6F54", team: "Events", prior_deficit_hours: 1.5 },
    { id: "sam", name: "Sam Okafor", initials: "SO", color: "#8C4B2B", team: "Events", prior_deficit_hours: 0 },
    { id: "lina", name: "Lina Haddad", initials: "LH", color: "#A83E5E", team: "Events", prior_deficit_hours: 2 },
    { id: "omar", name: "Omar Saleh", initials: "OS", color: "#3E7A8C", team: "Media", prior_deficit_hours: 0 },
    { id: "mia", name: "Mia Chen", initials: "MC", color: "#7A6A2E", team: "Media", prior_deficit_hours: 0 },
    { id: "noah", name: "Noah Williams", initials: "NW", color: "#4E5E9E", team: "Outreach", prior_deficit_hours: 0.5 },
    { id: "zara", name: "Zara Ahmed", initials: "ZA", color: "#9C6B1F", team: "Outreach", prior_deficit_hours: 0 },
    { id: "ben", name: "Ben Carter", initials: "BC", color: "#5E7A2E", team: "Outreach", prior_deficit_hours: 0, active: false },
  ].map((m, i) => ({
    active: true, photo_url: null, email_reminders: true,
    ...m, email: mail(m.id), created_at: iso(-120 + i),
  }));

  const roles = [
    { email: mail("alex"), role: "owner" },
    { email: mail("priya"), role: "admin" },
    { email: mail("jordan"), role: "team_admin" },
    { email: mail("omar"), role: "team_admin" },
  ].map((r) => ({ ...r, updated_at: iso(-100) }));

  const events = ["General", "Charity Gala", "Open Day", "Winter Food Drive", "Sports Carnival"].map((name, i) => ({
    id: uid("ev"), name, sort_order: i, executive: false, created_at: iso(-110 + i),
  }));
  events.push({ id: uid("ev"), name: "Exec Planning", sort_order: 5, executive: true, created_at: iso(-90) });

  // [title, event, assignees, assigner, priority, dueOffset, col, createdOffset, extra]
  const T = [
    ["Book the venue for the Charity Gala", "Charity Gala", ["priya"], "alex", "urgent", 3, "doing", -12, { description: "Shortlist: town hall, college auditorium. Need capacity for 250 and a stage.", links: ["https://example.com/venue-quotes"] }],
    ["Design gala invitations", "Charity Gala", ["mia", "omar"], "priya", "normal", 6, "doing", -9, { description: "Navy + gold theme. Print and digital versions." }],
    ["Confirm catering quotes", "Charity Gala", ["lina"], "jordan", "urgent", -1, "todo", -8, {}],
    ["Sponsor outreach emails", "Charity Gala", ["noah", "zara"], "alex", "normal", 8, "todo", -6, { links: ["https://example.com/sponsor-list"] }],
    ["Volunteer roster for gala night", "Charity Gala", ["sam"], "jordan", "normal", 12, "todo", -3, {}],
    ["Open Day stall layout", "Open Day", ["jordan", "sam"], "priya", "normal", 15, "todo", -4, {}],
    ["Print flyers for Open Day", "Open Day", ["omar"], "jordan", "low", 18, "todo", -2, {}],
    ["Photo slideshow for Open Day screen", "Open Day", ["mia"], "omar", "low", 20, "todo", -1, {}],
    ["Collection boxes at 3 local schools", "Winter Food Drive", ["zara"], "noah", "urgent", 1, "doing", -10, { description: "Drop off Monday, collect Friday." }],
    ["Social posts: food drive countdown", "Winter Food Drive", ["mia"], "omar", "normal", 2, "todo", -5, {}],
    ["Sports Carnival permission forms", "Sports Carnival", ["lina"], "jordan", "normal", -3, "todo", -14, {}],
    ["Order team shirts", "Sports Carnival", ["sam", "lina"], "jordan", "normal", 9, "doing", -7, {}],
    ["Weekly newsletter", "General", ["omar"], "priya", "normal", 4, "todo", -2, { repeat_every: "weekly" }],
    ["Update member handbook", "General", ["priya"], "alex", "low", 25, "todo", -11, {}],
    ["Budget review for term 4", "Exec Planning", ["alex", "priya"], "alex", "urgent", 5, "todo", -6, { executive: true, description: "Executive-only: only owners and execs can see this task." }],
    // Done
    ["Book photographer", "Charity Gala", ["omar"], "priya", "normal", -2, "done", -15, { minutes_spent: 45, completion_notes: "Booked for 6pm-10pm." }],
    ["Draft gala run sheet", "Charity Gala", ["jordan"], "alex", "urgent", -1, "done", -13, { minutes_spent: 120 }],
    ["Food drive poster", "Winter Food Drive", ["mia"], "omar", "normal", -4, "done", -12, { minutes_spent: 90 }],
    ["Weekly newsletter", "General", ["omar"], "priya", "normal", -3, "done", -9, { minutes_spent: 60, repeat_every: "weekly" }],
    ["Reach out to local food bank", "Winter Food Drive", ["noah"], "noah", "normal", -6, "done", -14, { minutes_spent: 30 }],
    ["Carnival schedule draft", "Sports Carnival", ["sam"], "jordan", "low", -5, "done", -16, { minutes_spent: 75 }],
  ];
  const tasks = T.map(([title, event, assignees, assigner, priority, dueOff, col, createdOff, extra]) => {
    const id = uid("task");
    return {
      id, title, event, assignee: assignees[0], assignees, assigner, priority,
      due: date(dueOff), col, created_at: iso(createdOff, 10),
      description: null, executive: false, archived_at: null, archived_by: null,
      repeat_every: null, recurrence_root: null, links: null,
      started_at: col !== "todo" ? iso(createdOff + 2, 15) : null,
      minutes_spent: null, completion_notes: null,
      ...extra,
    };
  });
  const nl = tasks.filter((t) => t.title === "Weekly newsletter");
  nl.forEach((t) => (t.recurrence_root = nl.find((x) => x.col === "done").id));

  // A few archived tasks so the Archive panel has something in it
  [["Old fundraiser raffle", "General", "sam", -40], ["Term 2 BBQ supplies", "General", "noah", -35]].forEach(([title, event, who, off]) =>
    tasks.push({
      id: uid("task"), title, event, assignee: who, assignees: [who], assigner: "priya", priority: "low",
      due: date(off + 7), col: "done", created_at: iso(off), description: null, executive: false,
      archived_at: iso(off + 10), archived_by: mail("priya"), repeat_every: null, recurrence_root: null,
      links: null, started_at: null, minutes_spent: 30, completion_notes: null,
    })
  );

  // Completion history: the done tasks above plus ~8 weeks of older work
  const completions = [];
  const complete = (t, completedOff, by) => {
    const dueT = new Date(t.due + "T00:00:00").getTime();
    const done = dayAt(completedOff, 16);
    const late = Math.max(0, Math.floor((new Date(done.toDateString()).getTime() - dueT) / DAY));
    completions.push({
      id: uid("cmp"), task_id: t.id, title: t.title, event: t.event, priority: t.priority,
      assignee: t.assignees[0], assignees: t.assignees, assigner: t.assigner,
      completed_by: mail(by || t.assignees[0]), completed_at: done.toISOString(),
      due: t.due, task_created_at: t.created_at, started_at: t.started_at,
      minutes_worked: t.minutes_spent, completion_notes: t.completion_notes,
      on_time: late === 0, days_late: late,
      days_to_complete: Math.max(0, Math.round((done - new Date(t.created_at)) / DAY)),
      reopened: false,
    });
  };
  tasks.filter((t) => t.col === "done" && !t.archived_at).forEach((t, i) => complete(t, -1 - (i % 4)));
  const history = [
    ["Plan welcome night", "General", ["priya", "jordan"], 180], ["Edit recap video", "General", ["mia"], 150],
    ["Collect RSVPs for info night", "Open Day", ["sam"], 40], ["Thank-you notes to sponsors", "Charity Gala", ["noah"], 50],
    ["Set up shared drive folders", "General", ["omar"], 35], ["Coordinate bus booking", "Sports Carnival", ["lina"], 60],
    ["Create volunteer sign-up form", "Winter Food Drive", ["zara"], 45], ["Meeting minutes template", "General", ["priya"], 20],
    ["Instagram story series", "Winter Food Drive", ["mia", "omar"], 120], ["Equipment checklist", "Sports Carnival", ["sam"], 30],
    ["Contact school principals", "Open Day", ["jordan"], 55], ["Venue walkthrough", "Charity Gala", ["alex", "jordan"], 90],
    ["Weekly newsletter", "General", ["omar"], 60], ["Weekly newsletter", "General", ["omar"], 55],
    ["Fundraising tracker spreadsheet", "Charity Gala", ["zara"], 70], ["First aid roster", "Sports Carnival", ["lina"], 25],
    ["Media release", "Charity Gala", ["mia"], 80], ["Donation drop-off map", "Winter Food Drive", ["noah", "zara"], 65],
  ];
  history.forEach(([title, event, assignees, mins], i) => {
    const createdOff = -56 + i * 2.5;
    const dueOff = Math.round(createdOff + 7);
    const doneOff = Math.round(dueOff + (i % 5 === 0 ? 2 : -1));
    complete({
      id: uid("task-old"), title, event, assignees, assigner: i % 2 ? "priya" : "jordan", priority: "normal",
      due: date(dueOff), created_at: iso(Math.round(createdOff), 11), started_at: null,
      minutes_spent: mins, completion_notes: null,
    }, Math.min(-1, doneOff));
  });
  if (completions[4]) completions[4].reopened = false;

  // Calendar: meetings and events in the past (with attendance) and upcoming (with RSVPs)
  const calendar_events = [];
  const calendar_event_attendees = [];
  const everyone = members.filter((m) => m.active).map((m) => m.id);
  const team = (t) => members.filter((m) => m.active && m.team === t).map((m) => m.id);
  const leaders = ["alex", "priya", "jordan", "omar"];
  const addEv = (title, kind, off, startH, hours, invited, opts = {}) => {
    const id = uid("cal");
    const past = off < 0;
    calendar_events.push({
      id, title, kind, starts_at: iso(off, startH), ends_at: iso(off, startH + Math.floor(hours), (hours % 1) * 60),
      location: opts.location || null, description: opts.description || null, private: !!opts.private,
      created_by: opts.by || "priya", created_by_email: mail(opts.by || "priya"), created_at: iso(off - 7),
    });
    invited.forEach((mid, i) => {
      const skip = opts.absent?.includes(mid);
      const declined = !past && opts.declined?.includes(mid);
      const pending = !past && opts.pending?.includes(mid);
      calendar_event_attendees.push({
        event_id: id, member_id: mid,
        rsvp: pending ? "pending" : declined ? "no" : "yes",
        rsvp_reason: declined ? "Exam that week" : null,
        responded_at: pending ? null : iso(off - 3 + (i % 2)),
        attended: past ? !skip : null,
      });
    });
  };
  for (let w = 1; w <= 7; w++) {
    addEv("Weekly leaders meeting", "leaders_meeting", -7 * w + 1, 17, 1, leaders, { location: "Room 4B", absent: w % 3 === 0 ? ["omar"] : [] });
    if (w % 2) addEv("Events team catch-up", "team_meeting", -7 * w + 3, 16, 1, team("Events"), { by: "jordan", absent: w === 3 ? ["lina"] : [] });
    if (w % 2 === 0) addEv("Media team catch-up", "team_meeting", -7 * w + 2, 16, 1, team("Media"), { by: "omar" });
  }
  addEv("Welcome night", "major_event", -30, 18, 3, everyone, { location: "Main hall", absent: ["noah"] });
  addEv("Food drive sorting day", "minor_event", -12, 10, 4, ["noah", "zara", "lina", "sam", "mia"], { by: "noah", location: "Community centre", absent: ["mia"] });
  addEv("Board games social", "club_event", -5, 15, 2, everyone, { by: "sam", absent: ["priya", "omar"] });
  addEv("Weekly leaders meeting", "leaders_meeting", 1, 17, 1, leaders, { location: "Room 4B", pending: ["omar"] });
  addEv("Events team catch-up", "team_meeting", 4, 16, 1, team("Events"), { by: "jordan", declined: ["lina"] });
  addEv("Charity Gala", "major_event", 14, 18, 4, everyone, { location: "Town hall", description: "Annual fundraiser. Dress code: formal.", pending: ["mia", "zara", "alex"], declined: ["noah"] });
  addEv("Open Day", "major_event", 21, 9, 6, everyone, { location: "Campus", pending: ["sam", "omar", "lina", "noah", "zara"] });
  addEv("Budget review (execs)", "leaders_meeting", 6, 18, 1.5, ["alex", "priya"], { private: true, by: "alex" });

  const debriefs = [
    { member: "jordan", from: -35, to: -21, mins: 260, eh: 7, tasks: 4, mi: 4, ma: 4, ei: 1, ea: 1, reflection: "Gala planning is on track. Need more help on the run sheet." },
    { member: "omar", from: -28, to: -14, mins: 190, eh: 4, tasks: 4, mi: 3, ma: 2, ei: 1, ea: 1, reflection: "Newsletter is now weekly. Missed one leaders meeting (exam)." },
    { member: "zara", from: -21, to: -7, mins: 115, eh: 4, tasks: 2, mi: 0, ma: 0, ei: 2, ea: 2, reflection: null },
  ].map((d) => ({
    id: uid("deb"), member_id: d.member, period_start: date(d.from), period_end: date(d.to),
    task_minutes: d.mins, event_hours: d.eh, tasks_completed: d.tasks,
    meetings_invited: d.mi, meetings_attended: d.ma, events_invited: d.ei, events_attended: d.ea,
    benchmark_hours: 6, reflection: d.reflection, items: { tasks: [], events: [] }, submitted_at: iso(d.to + 1, 20),
  }));

  const audit_log = [
    [-30, "alex", "created event “Charity Gala”"], [-15, "priya", "created task “Book photographer”"],
    [-12, "alex", "created task “Book the venue for the Charity Gala”"], [-9, "priya", "created task “Design gala invitations”"],
    [-8, "jordan", "created task “Confirm catering quotes”"], [-5, "omar", "completed “Book photographer”"],
    [-4, "priya", "archived task “Term 2 BBQ supplies”"], [-3, "jordan", "completed “Draft gala run sheet”"],
    [-2, "jordan", "submitted a debrief"], [-1, "priya", "scheduled “Charity Gala” (major event)"],
  ].map(([off, who, action]) => ({ id: uid("aud"), actor: mail(who), action, created_at: iso(off, 14) }));

  const tracking = new Date(now().getTime() - 56 * DAY);
  const app_settings = [
    { key: "benchmark_hours_per_week", value: 3 },
    { key: "tracking_start", value: date(-56) },
    { key: "drive_url", value: "https://drive.google.com/" },
    { key: "reminder_days_ahead", value: 2 },
  ].map((s) => ({ ...s, updated_at: tracking.toISOString() }));

  return { members, roles, events, tasks, task_completions: completions, calendar_events, calendar_event_attendees, debriefs, audit_log, app_settings };
}

export const PERSONAS = [
  { id: "alex", label: "Alex · Owner" },
  { id: "priya", label: "Priya · Exec" },
  { id: "jordan", label: "Jordan · Team admin" },
  { id: "sam", label: "Sam · Leader" },
];
export const personaEmail = (id) => mail(id);
