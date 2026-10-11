// An in-browser stand-in for the Supabase client, used by the public demo.
//
// It implements just the parts of supabase-js the app calls (query builder,
// auth, realtime channels, edge functions) on top of an in-memory copy of the
// sample data in seed.js. It also mimics the server-side rules the real
// database enforces with RLS policies and triggers: role-based visibility,
// completion records written when a task moves to Done, recurring tasks,
// audit log entries. Nothing leaves the browser.

import { buildSeed, personaEmail, DEMO_DOMAIN } from "./seed.js";

const DB_KEY = "app-demo-db-v1";
const USER_KEY = "app-demo-user";
const OUT_KEY = "app-demo-signed-out";

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode: in-memory only */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

let db = (() => {
  try {
    const saved = JSON.parse(store.get(DB_KEY));
    if (saved && saved.tasks) return saved;
  } catch { /* fall through */ }
  return buildSeed();
})();
const persist = () => store.set(DB_KEY, JSON.stringify(db));

export const resetDemo = () => {
  store.del(DB_KEY);
  window.location.reload();
};
export const currentPersonaEmail = () => store.get(USER_KEY) || personaEmail("alex");
export const switchPersona = (id) => {
  store.set(USER_KEY, personaEmail(id));
  store.del(OUT_KEY);
  window.location.reload();
};

// ---------- who is signed in ----------
const userObj = () => {
  const email = currentPersonaEmail();
  return { id: "user-" + email, email };
};
const sessionObj = () => (store.get(OUT_KEY) ? null : { access_token: "demo-token", user: userObj() });
const me = () => {
  const email = currentPersonaEmail();
  const member = db.members.find((m) => m.email === email);
  const role = (db.roles.find((r) => r.email === email) || {}).role || "leader";
  return { email, member, id: member?.id, role, exec: role === "owner" || role === "admin", owner: role === "owner", teamAdmin: ["owner", "admin", "team_admin"].includes(role) };
};

// ---------- helpers ----------
const clone = (x) => JSON.parse(JSON.stringify(x));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2));
const nowIso = () => new Date().toISOString();
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const denied = (msg = "permission denied (demo role)") => ({ data: null, error: { message: msg, code: "42501" } });
const audit = (action) => db.audit_log.push({ id: uuid(), actor: me().email, action, created_at: nowIso() });
const sameTeam = (memberId) => {
  const u = me();
  const a = db.members.find((m) => m.id === memberId);
  return a && u.member && a.team && a.team === u.member.team;
};

// Row visibility, mirroring the SELECT policies
const canSee = {
  tasks: (t) => {
    const u = me();
    if (u.exec) return true;
    if (t.archived_at || t.executive) return false;
    return !db.events.some((e) => e.executive && e.name === t.event);
  },
  events: (e) => me().exec || !e.executive,
  task_completions: (c) => {
    const u = me();
    const who = c.assignees || [c.assignee];
    if (u.exec) return true;
    if (who.includes(u.id)) return true;
    return u.role === "team_admin" && who.some(sameTeam);
  },
  debriefs: (d) => {
    const u = me();
    return u.exec || d.member_id === u.id || (u.role === "team_admin" && sameTeam(d.member_id));
  },
  calendar_events: (e) => me().exec || !e.private,
  audit_log: () => me().exec,
};

// Who may write what, mirroring the INSERT/UPDATE/DELETE policies
const KIND_RULE = { major_event: "exec", leaders_meeting: "exec", team_meeting: "team", minor_event: "all", club_event: "all" };
const canWrite = (table, op, row) => {
  const u = me();
  switch (table) {
    case "events": return u.exec;
    case "members": case "roles": return u.owner;
    case "app_settings": return u.exec;
    case "task_completions": case "audit_log": return op === "delete" && u.owner;
    case "tasks": return op === "delete" ? u.exec : true;
    case "calendar_events": {
      if (op === "insert" || op === "update") {
        const r = KIND_RULE[row.kind] || "all";
        if (r === "exec" && !u.exec) return false;
        if (r === "team" && !u.teamAdmin) return false;
        if (row.private && !u.exec) return false;
      }
      return u.exec || row.created_by === u.id || row.created_by_email === u.email || op === "insert";
    }
    default: return true;
  }
};

const KEY = { roles: ["email"], app_settings: ["key"], calendar_event_attendees: ["event_id", "member_id"], members: ["id"] };
const keyOf = (table) => KEY[table] || ["id"];
const sameKey = (table, a, b) => keyOf(table).every((k) => a[k] === b[k]);

// ---------- realtime ----------
const channels = new Set();
const emit = (table, eventType, newRow, oldRow) => {
  if (canSee[table] && newRow && !canSee[table](newRow)) return;
  setTimeout(() => {
    channels.forEach((ch) =>
      ch.handlers.forEach(({ filter, cb }) => {
        if (filter.table !== table) return;
        if (filter.event !== "*" && filter.event !== eventType) return;
        cb({ eventType, new: newRow ? clone(newRow) : {}, old: oldRow ? clone(oldRow) : {} });
      })
    );
  }, 0);
};

// ---------- "database triggers" ----------
const DAY = 86400000;
const STEP = { daily: [1, 0], weekly: [7, 0], fortnightly: [14, 0], monthly: [0, 1], quarterly: [0, 3], yearly: [0, 12] };
const addStep = (dateStr, every) => {
  const [days, months] = STEP[every];
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const taskDefaults = (t) => ({
  id: uuid(), created_at: nowIso(), col: "todo", priority: "normal", description: null, executive: false,
  archived_at: null, archived_by: null, repeat_every: null, recurrence_root: null, links: null,
  started_at: null, minutes_spent: null, completion_notes: null, ...t,
  assignees: t.assignees || (t.assignee ? [t.assignee] : []),
  assignee: (t.assignees && t.assignees[0]) || t.assignee || null,
});

const onTaskWritten = (oldT, t) => {
  if (t.col === "doing" && !t.started_at) t.started_at = nowIso();
  const wasDone = oldT && oldT.col === "done";
  if (t.col === "done" && !wasDone) {
    const dueT = new Date(t.due + "T00:00:00").getTime();
    const late = Math.max(0, Math.floor((new Date(new Date().toDateString()).getTime() - dueT) / DAY));
    const row = {
      id: uuid(), task_id: t.id, title: t.title, event: t.event, priority: t.priority,
      assignee: t.assignee, assignees: t.assignees, assigner: t.assigner, completed_by: me().email,
      completed_at: nowIso(), due: t.due, task_created_at: t.created_at, started_at: t.started_at,
      minutes_worked: t.minutes_spent, completion_notes: t.completion_notes,
      on_time: late === 0, days_late: late,
      days_to_complete: Math.max(0, Math.round((Date.now() - new Date(t.created_at)) / DAY)), reopened: false,
    };
    db.task_completions.push(row);
    audit(`completed “${t.title}”`);
    // Recurring series: spawn the next open occurrence
    if (t.repeat_every && STEP[t.repeat_every]) {
      const root = t.recurrence_root || t.id;
      const open = db.tasks.some((x) => (x.recurrence_root === root || x.id === root) && x.col !== "done" && !x.archived_at && x.id !== t.id);
      if (!open) {
        let due = addStep(t.due, t.repeat_every);
        while (due < todayStr()) due = addStep(due, t.repeat_every);
        const next = taskDefaults({
          title: t.title, event: t.event, assignees: t.assignees, assigner: t.assigner, priority: t.priority,
          due, description: t.description, executive: t.executive, repeat_every: t.repeat_every, recurrence_root: root,
        });
        db.tasks.push(next);
        emit("tasks", "INSERT", next);
      }
    }
  } else if (wasDone && t.col !== "done") {
    const last = [...db.task_completions].reverse().find((c) => c.task_id === t.id && !c.reopened);
    if (last) last.reopened = true;
  }
  if (oldT && !oldT.archived_at && t.archived_at) audit(`archived task “${t.title}”`);
  if (oldT && oldT.archived_at && !t.archived_at) audit(`restored task “${t.title}”`);
};

// ---------- query builder ----------
class Query {
  constructor(table) {
    this.table = table;
    this.op = "select";
    this.filters = [];
    this.orders = [];
    this.limitN = null;
    this.wantSingle = false;
    this.returning = false;
  }
  select() { if (this.op !== "select") this.returning = true; return this; }
  insert(rows) { this.op = "insert"; this.payload = rows; return this; }
  update(fields) { this.op = "update"; this.payload = fields; return this; }
  upsert(rows) { this.op = "upsert"; this.payload = rows; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
  in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  not(c, op, v) { if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  lte(c, v) { this.filters.push((r) => r[c] <= v); return this; }
  order(c, { ascending = true } = {}) { this.orders.push([c, ascending]); return this; }
  limit(n) { this.limitN = n; return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantSingle = true; return this; }
  then(res, rej) {
    return new Promise((r) => setTimeout(r, 60)).then(() => this.run()).then(res, rej);
  }

  rows() {
    if (!db[this.table]) db[this.table] = [];
    return db[this.table];
  }
  matches(r) { return this.filters.every((f) => f(r)); }
  visible(r) { return !canSee[this.table] || canSee[this.table](r); }

  run() {
    const t = this.table;
    let out;
    if (this.op === "select") {
      out = this.rows().filter((r) => this.visible(r) && this.matches(r));
      for (const [c, asc] of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => {
          const x = a[c] ?? "", y = b[c] ?? "";
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this.limitN != null) out = out.slice(0, this.limitN);
    } else if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      out = [];
      for (const raw of list) {
        let row = { ...raw };
        if (t === "tasks") row = taskDefaults(row);
        else if (t === "calendar_events") row = { id: uuid(), created_at: nowIso(), private: false, created_by_email: me().email, ...row };
        else if (t === "calendar_event_attendees") row = { rsvp: "pending", rsvp_reason: null, responded_at: null, attended: null, ...row };
        else if (t === "members") row = { active: true, created_at: nowIso(), team: null, prior_deficit_hours: 0, photo_url: null, email_reminders: true, ...row };
        else if (t === "debriefs") row = { id: uuid(), submitted_at: nowIso(), ...row };
        else if (!keyOf(t).every((k) => row[k] !== undefined)) row = { id: uuid(), created_at: nowIso(), ...row };
        if (!canWrite(t, "insert", row)) return denied();
        const existing = this.rows().find((r) => sameKey(t, r, row));
        if (existing) {
          if (this.op === "insert") return { data: null, error: { message: "duplicate key value", code: "23505" } };
          const old = clone(existing);
          Object.assign(existing, row);
          emit(t, "UPDATE", existing, old);
          out.push(existing);
        } else {
          this.rows().push(row);
          if (t === "tasks") { onTaskWritten(null, row); audit(`created task “${row.title}”`); }
          if (t === "events") audit(`created event “${row.name}”`);
          if (t === "calendar_events") audit(`scheduled “${row.title}”`);
          if (t === "debriefs") audit("submitted a debrief");
          emit(t, "INSERT", row);
          out.push(row);
        }
      }
    } else if (this.op === "update") {
      const targets = this.rows().filter((r) => this.visible(r) && this.matches(r));
      for (const r of targets) {
        if (t === "calendar_event_attendees") {
          // Invitees may only change their own RSVP; attendance is the organiser's call
          const ev = db.calendar_events.find((e) => e.id === r.event_id);
          const manager = me().exec || ev?.created_by === me().id;
          if (!manager && (r.member_id !== me().id || "attended" in this.payload)) return denied();
        } else if (!canWrite(t, "update", { ...r, ...this.payload })) return denied();
      }
      out = targets.map((r) => {
        const old = clone(r);
        Object.assign(r, this.payload);
        if (t === "tasks") {
          if ("assignees" in this.payload) r.assignee = r.assignees[0] || null;
          onTaskWritten(old, r);
        }
        if (t === "calendar_event_attendees" && "rsvp" in this.payload) r.responded_at = nowIso();
        if (t === "events" && "name" in this.payload && old.name !== r.name) audit(`renamed event “${old.name}” to “${r.name}”`);
        emit(t, "UPDATE", r, old);
        return r;
      });
    } else if (this.op === "delete") {
      const targets = this.rows().filter((r) => this.visible(r) && this.matches(r));
      for (const r of targets) if (!canWrite(t, "delete", r)) return denied();
      db[t] = this.rows().filter((r) => !targets.includes(r));
      if (t === "calendar_events") {
        const ids = new Set(targets.map((x) => x.id));
        db.calendar_event_attendees = db.calendar_event_attendees.filter((a) => !ids.has(a.event_id));
      }
      targets.forEach((r) => {
        if (t === "tasks") audit(`deleted task “${r.title}”`);
        if (t === "events") audit(`deleted event “${r.name}”`);
        emit(t, "DELETE", null, r);
      });
      if (t === "task_completions" && targets.length) audit("reset all stats");
      if (t === "audit_log") audit("cleared the audit log");
      out = targets;
    }
    persist();
    const data = clone(out);
    if (this.wantSingle) return { data: data[0] ?? null, error: data.length ? null : { message: "no rows" } };
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    return { data, error: null };
  }
}

// ---------- the client ----------
export function createDemoClient() {
  const authListeners = new Set();
  const fireAuth = (event) => authListeners.forEach((cb) => cb(event, sessionObj()));

  const functions = {
    async invoke(name, { body } = {}) {
      await new Promise((r) => setTimeout(r, 300));
      const u = me();
      if (name === "manage-users") {
        if (!u.owner) return { data: { error: "Owners only" }, error: null };
        if (body?.action === "list_users") {
          return { data: { users: db.members.filter((m) => m.email).map((m) => ({ email: m.email, mfa: false })) }, error: null };
        }
        return { data: { ok: true }, error: null };
      }
      if (name === "send-reminders") {
        if (!u.exec) return { data: { error: "Execs only" }, error: null };
        const days = Number((db.app_settings.find((s) => s.key === "reminder_days_ahead") || {}).value ?? 2);
        const t0 = todayStr();
        const limit = new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
        const recipients = db.members
          .filter((m) => m.active && m.email && m.email_reminders)
          .map((m) => {
            const open = db.tasks.filter((t) => !t.archived_at && t.col !== "done" && (t.assignees || []).includes(m.id));
            return {
              member_id: m.id, name: m.name,
              due_soon: open.filter((t) => t.due >= t0 && t.due <= limit).length,
              overdue: open.filter((t) => t.due < t0).length,
              invites: db.calendar_event_attendees.filter((a) => a.member_id === m.id && a.rsvp === "pending").length,
            };
          })
          .filter((r) => r.due_soon || r.overdue || r.invites);
        // The demo never sends email; a real send goes through Brevo.
        return { data: body?.dry_run ? { recipients } : { sent: recipients.length }, error: null };
      }
      return { data: null, error: { message: "Unknown function" } };
    },
  };

  return {
    from: (table) => new Query(table),
    channel() {
      const ch = { handlers: [], on(_type, filter, cb) { ch.handlers.push({ filter, cb }); return ch; }, subscribe() { channels.add(ch); return ch; } };
      return ch;
    },
    removeChannel(ch) { channels.delete(ch); },
    realtime: { setAuth() {} },
    functions,
    auth: {
      async getSession() { return { data: { session: sessionObj() }, error: null }; },
      onAuthStateChange(cb) {
        authListeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
      },
      async signInWithPassword({ email }) {
        const e = (email || "").trim().toLowerCase();
        if (!db.members.some((m) => m.email === e && m.active)) {
          return { data: null, error: { message: `Invalid login credentials. Demo accounts end in @${DEMO_DOMAIN}, any password works.` } };
        }
        store.set(USER_KEY, e);
        store.del(OUT_KEY);
        fireAuth("SIGNED_IN");
        return { data: { session: sessionObj() }, error: null };
      },
      async signOut() { store.set(OUT_KEY, "1"); fireAuth("SIGNED_OUT"); return { error: null }; },
      async updateUser() { return { data: {}, error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      mfa: {
        async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }; },
        async listFactors() { return { data: { totp: [], all: [] }, error: null }; },
        async enroll() { return { data: null, error: { message: "2FA is switched off in the demo." } }; },
        async challengeAndVerify() { return { data: null, error: { message: "2FA is switched off in the demo." } }; },
        async unenroll() { return { data: {}, error: null }; },
      },
    },
  };
}
