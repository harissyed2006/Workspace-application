import { useState, useMemo, useEffect } from "react";
import { supabase } from "./supabase.js";
import {
  C, mono, sans, PRIORITIES, COLUMNS, REPEATS,
  repeatLabel, MEMBER_COLORS, Logo, member, memberForEmail, memberNameForEmail,
  roleForEmail, taskAssignees, today, daysUntil, plusDays, dueMeta,
  Avatar, Tag, roleLabel, fmtMinutes, saveBlob, isoDate, fmtDate,
} from "./shared.jsx";
import HomePage from "./HomePage.jsx";
import EventsPage from "./EventsPage.jsx";
import DebriefsPage from "./DebriefsPage.jsx";


// ==================================================================
// App shell
// ==================================================================
export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false); // signed in with password, 2FA code still owed
  const [recovery, setRecovery] = useState(false); // arrived via a password-reset email link

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token);
    }
  }, [session]);

  // If this user has 2FA enrolled, hold the board back until they enter a code.
  useEffect(() => {
    if (!session) {
      setNeedsMfa(false);
      return;
    }
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      setNeedsMfa(!!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2");
    });
  }, [session]);

  if (!authReady) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: sans, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: C.inkSoft }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!session) return <Login />;

  if (recovery) return <RecoveryScreen onDone={() => setRecovery(false)} />;

  if (needsMfa) return <MfaGate />;

  return <Board user={session.user} />;
}

// ==================================================================
// 2FA code gate — shown after password login when a TOTP factor exists
// ==================================================================
function MfaGate() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (code.length < 6 || busy) return;
    setBusy(true);
    setErr("");
    const { data: f } = await supabase.auth.mfa.listFactors();
    const factor = (f?.totp || []).find((x) => x.status === "verified");
    if (!factor) {
      setErr("No authenticator found — sign out and back in, or ask an owner.");
      setBusy(false);
      return;
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: code.trim(),
    });
    setBusy(false);
    if (error) {
      setErr("That code didn't work — check your authenticator app and try again.");
      setCode("");
    }
    // On success the session refreshes and App re-checks the assurance level.
  };

  return (
    <div className="app-page" style={{ minHeight: "100vh", background: C.bg, fontFamily: sans, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "30px 28px", width: "100%", maxWidth: 380, textAlign: "center" }}>
        <Logo size={56} />
        <h1 style={{ margin: "12px 0 4px", fontSize: 20, fontWeight: 800, color: C.ink }}>Two-factor check</h1>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: C.inkSoft }}>
          Enter the 6-digit code from your authenticator app.
        </p>
        <input
          style={{
            width: "100%", padding: "12px", borderRadius: 8, border: `1px solid ${C.line}`,
            fontSize: 22, fontFamily: mono, letterSpacing: 8, textAlign: "center",
            color: C.ink, background: "#fff", boxSizing: "border-box",
          }}
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="••••••"
          autoFocus
        />
        {err && (
          <div style={{ marginTop: 12, background: C.redSoft, border: `1px solid ${C.red}44`, color: C.ink, borderRadius: 8, padding: "9px 12px", fontSize: 13, textAlign: "left" }}>
            {err}
          </div>
        )}
        <button
          onClick={submit}
          disabled={busy || code.length < 6}
          style={{ width: "100%", marginTop: 16, background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: sans, opacity: busy || code.length < 6 ? 0.6 : 1 }}
        >
          {busy ? "Checking…" : "Verify"}
        </button>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{ width: "100%", marginTop: 10, background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

// ==================================================================
// Recovery screen — user arrived via a password-reset email link
// ==================================================================
function RecoveryScreen({ onDone }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    if (pw1.length < 8) return setErr("Password must be at least 8 characters.");
    if (pw1 !== pw2) return setErr("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) setErr(error.message);
    else onDone();
  };

  const input = {
    width: "100%", padding: "11px 12px", borderRadius: 8, border: `1px solid ${C.line}`,
    fontSize: 14, fontFamily: sans, color: C.ink, background: "#fff", boxSizing: "border-box",
  };
  const label = { fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, display: "block", marginBottom: 6, marginTop: 14, textAlign: "left" };

  return (
    <div className="app-page" style={{ minHeight: "100vh", background: C.bg, fontFamily: sans, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "30px 28px", width: "100%", maxWidth: 380, textAlign: "center" }}>
        <Logo size={56} />
        <h1 style={{ margin: "12px 0 4px", fontSize: 20, fontWeight: 800, color: C.ink }}>Set a new password</h1>
        <p style={{ margin: 0, fontSize: 13, color: C.inkSoft }}>
          You followed a reset link — choose a new password for your account.
        </p>
        <label style={label}>New password</label>
        <input style={input} type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="At least 8 characters" autoFocus />
        <label style={label}>Confirm new password</label>
        <input style={input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        {err && (
          <div style={{ marginTop: 12, background: C.redSoft, border: `1px solid ${C.red}44`, color: C.ink, borderRadius: 8, padding: "9px 12px", fontSize: 13, textAlign: "left" }}>
            {err}
          </div>
        )}
        <button
          onClick={save}
          disabled={busy}
          style={{ width: "100%", marginTop: 18, background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: sans, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Saving…" : "Save password"}
        </button>
      </div>
    </div>
  );
}

// ==================================================================
// Login screen — with attempt limiting
// ==================================================================
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [resetMsg, setResetMsg] = useState("");

  const sendReset = async () => {
    const em = email.trim();
    if (!em) return setResetMsg("Type your email above first, then click reset again.");
    setResetMsg("");
    await supabase.auth.resetPasswordForEmail(em, { redirectTo: window.location.origin });
    setResetMsg("A reset link is on its way — check your inbox (and spam).");
  };
  const [lockedUntil, setLockedUntil] = useState(() => {
    const v = Number(localStorage.getItem("app-lockout") || 0);
    return v > Date.now() ? v : 0;
  });
  const [, forceTick] = useState(0);

  // Tick every second while locked, so the countdown updates
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => {
      forceTick((n) => n + 1);
      if (Date.now() >= lockedUntil) {
        setLockedUntil(0);
        localStorage.removeItem("app-lockout");
        localStorage.removeItem("app-fails");
      }
    }, 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const secondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;

  const signIn = async () => {
    if (!email.trim() || !password || secondsLeft > 0) return;
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      const fails = Number(localStorage.getItem("app-fails") || 0) + 1;
      localStorage.setItem("app-fails", String(fails));
      if (fails >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_SECONDS * 1000;
        localStorage.setItem("app-lockout", String(until));
        setLockedUntil(until);
        setErr("");
      } else {
        setErr(
          error.message === "Invalid login credentials"
            ? `Wrong email or password (${MAX_ATTEMPTS - fails} attempts left). Ask an owner if you need a reset.`
            : error.message
        );
      }
    } else {
      localStorage.removeItem("app-fails");
      localStorage.removeItem("app-lockout");
    }
    setBusy(false);
  };

  const input = {
    width: "100%", padding: "11px 12px", borderRadius: 8, border: `1px solid ${C.line}`,
    fontSize: 14, fontFamily: sans, color: C.ink, background: "#fff", boxSizing: "border-box",
  };
  const label = { fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, display: "block", marginBottom: 6, marginTop: 14 };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: sans, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "30px 28px", width: "100%", maxWidth: 380, textAlign: "center" }}>
        <Logo size={64} />
        <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: 2, color: C.accent, textTransform: "uppercase", margin: "10px 0 2px" }}>
          Team · Operations
        </div>
        <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.ink, letterSpacing: -0.5 }}>Workspace</h1>
        <p style={{ margin: 0, fontSize: 13, color: C.inkSoft }}>Sign in with your Workspace account.</p>

        <div style={{ textAlign: "left" }}>
          <label style={label}>Email</label>
          <input
            style={input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoFocus
          />

          <label style={label}>Password</label>
          <input
            style={input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && signIn()}
            placeholder="••••••••"
          />
        </div>

        {secondsLeft > 0 && (
          <div style={{ marginTop: 12, background: C.amberSoft, border: `1px solid ${C.amber}44`, color: C.ink, borderRadius: 8, padding: "9px 12px", fontSize: 13, textAlign: "left" }}>
            Too many failed attempts. Try again in {secondsLeft}s.
          </div>
        )}

        {err && secondsLeft === 0 && (
          <div style={{ marginTop: 12, background: C.redSoft, border: `1px solid ${C.red}44`, color: C.ink, borderRadius: 8, padding: "9px 12px", fontSize: 13, textAlign: "left" }}>
            {err}
          </div>
        )}

        <button
          onClick={signIn}
          disabled={busy || secondsLeft > 0}
          style={{
            width: "100%", marginTop: 18, background: C.accent, color: "#fff", border: "none",
            borderRadius: 8, padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: "pointer",
            fontFamily: sans, opacity: busy || secondsLeft > 0 ? 0.6 : 1,
          }}
        >
          {busy ? "Signing in…" : secondsLeft > 0 ? `Locked (${secondsLeft}s)` : "Sign in"}
        </button>

        {resetMsg && (
          <div style={{ marginTop: 12, background: C.accentSoft, border: `1px solid ${C.accent}44`, color: C.ink, borderRadius: 8, padding: "9px 12px", fontSize: 12.5, textAlign: "left" }}>
            {resetMsg}
          </div>
        )}

        <button
          onClick={sendReset}
          disabled={busy}
          style={{ marginTop: 12, background: "transparent", color: C.accent, border: "none", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: sans, textDecoration: "underline" }}
        >
          Forgot password? Email me a reset link
        </button>

        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: C.inkSoft, lineHeight: 1.5 }}>
          No account? Accounts are created by the board admin — ask an owner.
        </p>
      </div>
    </div>
  );
}

// ==================================================================
// The board
// ==================================================================
function Board({ user }) {
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]); // [{id, name}]
  const [members, setMembers] = useState([]); // from public.members
  const [roles, setRoles] = useState([]); // from public.roles
  const [calEvents, setCalEvents] = useState([]); // scheduled/logged events (calendar_events)
  const [attendees, setAttendees] = useState([]); // calendar_event_attendees
  const [settings, setSettings] = useState({}); // app_settings as { key: value }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncNote, setSyncNote] = useState("");
  const [eventFilter, setEventFilter] = useState([]); // [] = all events
  const [personFilter, setPersonFilter] = useState([]); // [] = everyone
  const [execFilter, setExecFilter] = useState(false); // admins: show only executive tasks
  const [dragId, setDragId] = useState(null);
  const [hoverCol, setHoverCol] = useState(null);
  const [dragEvent, setDragEvent] = useState(null); // event tab being dragged (admin reorder)
  const [dragOverEvent, setDragOverEvent] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showAccount, setShowAccount] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [completing, setCompleting] = useState(null); // task being marked Done

  const myRole = roleForEmail(roles, user.email);
  const owner = myRole === "owner";
  // "Execs" = owners + admins (every exec power); team admins are a separate,
  // smaller tier — they must NOT pass the exec checks.
  const admin = myRole === "owner" || myRole === "admin";
  const teamAdmin = admin || myRole === "team_admin";
  const [page, setPage] = useState("home"); // home | tasks | events | debriefs
  const activeMembers = useMemo(() => members.filter((m) => m.active), [members]);
  const me =
    memberForEmail(members, user.email) ||
    { id: "?", name: (user.email || "").split("@")[0], initials: "?", color: "#8A8F9C" };

  const note = (msg, isError = false) => {
    setSyncNote(msg);
    setTimeout(() => setSyncNote(""), 2500);
    if (isError) console.error(msg);
  };

  const reloadRoles = async () => {
    const { data } = await supabase.from("roles").select("*");
    if (data) setRoles(data);
  };

  // Initial load: tasks + events + members + roles
  useEffect(() => {
    (async () => {
      const [t, e, m, r, ce, ca, st] = await Promise.all([
        supabase.from("tasks").select("*").is("archived_at", null).order("created_at", { ascending: true }),
        supabase.from("events").select("*").order("created_at", { ascending: true }),
        supabase.from("members").select("*").order("created_at", { ascending: true }),
        supabase.from("roles").select("*"),
        supabase.from("calendar_events").select("*").order("starts_at", { ascending: true }),
        supabase.from("calendar_event_attendees").select("*"),
        supabase.from("app_settings").select("*"),
      ]);
      if (t.error || e.error || m.error || r.error) {
        setError("Couldn't load the board. If this keeps happening, tell an owner.");
      } else {
        setTasks(t.data);
        setEvents(e.data);
        setMembers(m.data);
        setRoles(r.data);
        // Events/debrief tables arrive with the new migration — the board
        // still works if it hasn't been run yet.
        setCalEvents(ce.data || []);
        setAttendees(ca.data || []);
        setSettings(Object.fromEntries((st.data || []).map((x) => [x.key, x.value])));
      }
      setLoading(false);
    })();
  }, []);

  // Realtime: tasks
  useEffect(() => {
    const channel = supabase
      .channel("tasks-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks" }, (p) => {
        if (p.new.archived_at) return;
        setTasks((ts) => (ts.some((t) => t.id === p.new.id) ? ts : [...ts, p.new]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks" }, (p) => {
        setTasks((ts) =>
          p.new.archived_at
            ? ts.filter((t) => t.id !== p.new.id) // archived → off the board
            : ts.some((t) => t.id === p.new.id)
              ? ts.map((t) => (t.id === p.new.id ? p.new : t))
              : [...ts, p.new] // restored from archive → back on the board
        );
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (p) => {
        setTasks((ts) => ts.filter((t) => t.id !== p.old.id));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // Realtime: members (so new/edited teammates appear for everyone)
  useEffect(() => {
    const channel = supabase
      .channel("members-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "members" }, (p) => {
        setMembers((ms) => (ms.some((m) => m.id === p.new.id) ? ms : [...ms, p.new]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "members" }, (p) => {
        setMembers((ms) => ms.map((m) => (m.id === p.new.id ? p.new : m)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "members" }, (p) => {
        setMembers((ms) => ms.filter((m) => m.id !== p.old.id));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // Realtime: events
  useEffect(() => {
    const channel = supabase
      .channel("events-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, (p) => {
        setEvents((es) => (es.some((e) => e.id === p.new.id) ? es : [...es, p.new]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "events" }, (p) => {
        setEvents((es) => es.map((e) => (e.id === p.new.id ? p.new : e)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "events" }, (p) => {
        setEvents((es) => es.filter((e) => e.id !== p.old.id));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // Realtime: scheduled events + RSVPs/attendance
  useEffect(() => {
    const upsert = (key) => (rows, row) =>
      rows.some((x) => key(x) === key(row)) ? rows.map((x) => (key(x) === key(row) ? row : x)) : [...rows, row];
    const evKey = (x) => x.id;
    const atKey = (x) => `${x.event_id}|${x.member_id}`;
    const channel = supabase
      .channel("calendar-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "calendar_events" }, (p) => {
        if (p.eventType === "DELETE") setCalEvents((es) => es.filter((e) => e.id !== p.old.id));
        else setCalEvents((es) => upsert(evKey)(es, p.new));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "calendar_event_attendees" }, (p) => {
        if (p.eventType === "DELETE") setAttendees((as) => as.filter((a) => atKey(a) !== atKey(p.old)));
        else setAttendees((as) => upsert(atKey)(as, p.new));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const reloadCalendar = async () => {
    const [ce, ca] = await Promise.all([
      supabase.from("calendar_events").select("*").order("starts_at", { ascending: true }),
      supabase.from("calendar_event_attendees").select("*"),
    ]);
    if (ce.data) setCalEvents(ce.data);
    if (ca.data) setAttendees(ca.data);
  };
  const reloadSettings = async () => {
    const { data } = await supabase.from("app_settings").select("*");
    if (data) setSettings(Object.fromEntries(data.map((x) => [x.key, x.value])));
  };

  // Admin-chosen order (sort_order), falling back to creation date
  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) ||
          (a.created_at < b.created_at ? -1 : 1)
      ),
    [events]
  );
  const eventNames = useMemo(() => sortedEvents.map((e) => e.name), [sortedEvents]);
  // Drop filter entries for events that no longer exist (renamed/deleted)
  const effectiveEventFilter = eventFilter.filter((n) => eventNames.includes(n));

  const toggleEventFilter = (name) =>
    setEventFilter((fs) => (fs.includes(name) ? fs.filter((n) => n !== name) : [...fs, name]));
  const togglePersonFilter = (id) =>
    setPersonFilter((fs) => (fs.includes(id) ? fs.filter((p) => p !== id) : [...fs, id]));

  // Executive tasks = flagged tasks, plus anything under an executive event
  const execEventNames = useMemo(
    () => new Set(events.filter((e) => e.executive).map((e) => e.name)),
    [events]
  );
  const visible = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (effectiveEventFilter.length === 0 || effectiveEventFilter.includes(t.event)) &&
          (personFilter.length === 0 ||
            taskAssignees(t).some((id) => personFilter.includes(id))) &&
          (!execFilter || t.executive || execEventNames.has(t.event))
      ),
    [tasks, effectiveEventFilter, personFilter, execFilter, execEventNames]
  );

  // Header tiles follow whatever filters are applied (events, people, exec)
  const filtered = effectiveEventFilter.length > 0 || personFilter.length > 0 || execFilter;
  const stats = useMemo(() => {
    const open = visible.filter((t) => t.col !== "done");
    return {
      dueSoon: open.filter((t) => daysUntil(t.due) <= 3).length,
      doing: visible.filter((t) => t.col === "doing").length,
      done: visible.filter((t) => t.col === "done").length,
    };
  }, [visible]);
  const filterSummary = [
    effectiveEventFilter.length ? effectiveEventFilter.join(", ") : null,
    personFilter.length ? personFilter.map((id) => member(members, id).name).join(", ") : null,
    execFilter ? "executive" : null,
  ].filter(Boolean).join(" · ");

  const workload = useMemo(
    () =>
      activeMembers.map((m) => ({
        ...m,
        open: tasks.filter((t) => taskAssignees(t).includes(m.id) && t.col !== "done").length,
      })),
    [tasks, activeMembers]
  );
  const maxLoad = Math.max(3, ...workload.map((w) => w.open));

  // ---------- Database actions ----------
  // Extra fields carry the minutes/notes captured by the completion dialog
  const moveTask = async (id, col, extra = {}) => {
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, col, ...extra } : t)));
    const { error } = await supabase.from("tasks").update({ col, ...extra }).eq("id", id);
    if (error) {
      setTasks(prev);
      note("Move failed — check your connection", true);
    } else {
      note("Saved ✓");
    }
  };

  const drop = (col) => {
    const task = tasks.find((t) => t.id === dragId);
    setDragId(null);
    setHoverCol(null);
    if (!task) return;
    // Ask for minutes + notes when a task is newly completed
    if (col === "done" && task.col !== "done") {
      setCompleting({
        title: task.title,
        apply: (extra) => moveTask(task.id, "done", extra),
      });
    } else moveTask(task.id, col);
  };

  const saveTask = async (data, extra = null) => {
    setEditing(null);
    // Keep the legacy single-assignee column in sync (first of the list)
    if (data.assignees?.length) data = { ...data, assignee: data.assignees[0] };
    // Newly completed from the task modal → collect minutes + notes first
    if (extra === null && data.col === "done") {
      const wasDone = data.id && tasks.find((t) => t.id === data.id)?.col === "done";
      if (!wasDone) {
        setCompleting({
          title: data.title,
          apply: (e) => saveTask(data, e),
        });
        return;
      }
    }
    if (extra) data = { ...data, ...extra };
    if (data.id) {
      const { id, ...fields } = data;
      const prev = tasks;
      setTasks((ts) => ts.map((t) => (t.id === id ? data : t)));
      const { error } = await supabase.from("tasks").update(fields).eq("id", id);
      if (error) {
        setTasks(prev);
        note("Save failed — try again", true);
      } else note("Saved ✓");
    } else {
      const { data: row, error } = await supabase
        .from("tasks")
        .insert(data)
        .select()
        .single();
      if (error) {
        note("Couldn't add task — try again", true);
      } else {
        setTasks((ts) => (ts.some((t) => t.id === row.id) ? ts : [...ts, row]));
        note("Saved ✓");
      }
    }
  };

  const deleteTask = async (id) => {
    setEditing(null);
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== id));
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) {
      setTasks(prev);
      note("Delete failed — try again", true);
    } else note("Deleted ✓");
  };

  // Admin-only: drag an event tab onto another to reorder; drop on "All"
  // moves it to the front. Order persists in events.sort_order for everyone.
  const reorderEvents = async (draggedName, targetName) => {
    setDragEvent(null);
    setDragOverEvent(null);
    if (!draggedName || draggedName === targetName) return;
    const names = eventNames.filter((n) => n !== draggedName);
    if (targetName === "All") names.unshift(draggedName);
    else names.splice(names.indexOf(targetName), 0, draggedName);
    const prev = events;
    const updated = events.map((e) => ({ ...e, sort_order: names.indexOf(e.name) + 1 }));
    setEvents(updated);
    const changed = updated.filter(
      (e) => e.sort_order !== prev.find((p) => p.id === e.id)?.sort_order
    );
    const results = await Promise.all(
      changed.map((e) =>
        supabase.from("events").update({ sort_order: e.sort_order }).eq("id", e.id)
      )
    );
    if (results.some((r) => r.error)) {
      setEvents(prev);
      note("Reorder failed — admin access needed", true);
    } else note("Order saved ✓");
  };

  // Admin-only: soft-archive. The task keeps all its data but leaves the board;
  // it can be restored (or permanently deleted) from the Archive panel.
  const archiveTask = async (id) => {
    setEditing(null);
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== id));
    const { error } = await supabase
      .from("tasks")
      .update({ archived_at: new Date().toISOString(), archived_by: user.email })
      .eq("id", id);
    if (error) {
      setTasks(prev);
      note("Archive failed — admin access needed", true);
    } else note("Archived ✓");
  };

  // Spreadsheet of the board as currently shown (respects the filters), with
  // every field entered when the task was made — for the weekly tasks email.
  const exportBoard = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Active board");
    const ACCENT = "FF4C5FD5", SOFT = "FFECEEFB";
    const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");
    const colName = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label]));
    ws.columns = [
      { header: "Task", key: "title", width: 38 },
      { header: "Event", key: "event", width: 18 },
      { header: "Assigned by", key: "assigner", width: 16 },
      { header: "Assignee(s)", key: "assignees", width: 26 },
      { header: "Date assigned", key: "created", width: 15 },
      { header: "Date due", key: "due", width: 14 },
      { header: "Urgency", key: "priority", width: 11 },
      { header: "Status", key: "status", width: 13 },
      { header: "Repeats", key: "repeat", width: 16 },
      ...(admin ? [{ header: "Executive", key: "exec", width: 11 }] : []),
      { header: "Description", key: "description", width: 44 },
      { header: "Links", key: "links", width: 36 },
    ];
    const order = { todo: 0, doing: 1, done: 2 };
    [...visible]
      .sort((a, b) => order[a.col] - order[b.col] || (a.due < b.due ? -1 : 1))
      .forEach((t, i) => {
        const row = ws.addRow({
          title: t.title,
          event: t.event,
          assigner: t.assigner ? member(members, t.assigner).name : "",
          assignees: taskAssignees(t).map((id) => member(members, id).name).join(", "),
          created: fmt(t.created_at),
          due: fmt(t.due),
          priority: (PRIORITIES[t.priority] || PRIORITIES.normal).label,
          status: colName[t.col] || t.col,
          repeat: t.repeat_every ? repeatLabel(t.repeat_every) : "",
          exec: t.executive ? "Yes" : "",
          description: t.description || "",
          links: (t.links || []).join("\n"),
        });
        row.alignment = { vertical: "top", wrapText: true };
        if (i % 2 === 1) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } }; });
      });
    const head = ws.getRow(1);
    head.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: { row: 1, column: ws.columns.length } };
    const buf = await wb.xlsx.writeBuffer();
    saveBlob(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `app-active-board-${isoDate(new Date())}.xlsx`
    );
    note(`Exported ${visible.length} task${visible.length === 1 ? "" : "s"} ✓`);
  };

  const signOut = () => supabase.auth.signOut();

  // ---------- Render ----------
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: sans, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: C.inkSoft }}>
          Loading Workspace…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: sans, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 10, padding: "18px 22px", maxWidth: 440, color: C.ink, fontSize: 14, lineHeight: 1.5 }}>
          {error}
        </div>
      </div>
    );
  }

  // Audit log is a full page, not a modal
  if (showAudit && admin) {
    return <AuditPage members={members} owner={owner} note={note} onBack={() => setShowAudit(false)} />;
  }

  return (
    <div className="app-page" style={{ minHeight: "100vh", background: C.bg, fontFamily: sans, color: C.ink, padding: "24px 20px 48px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Logo size={52} />
            <div>
              <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: 2, color: C.accent, textTransform: "uppercase", marginBottom: 4 }}>
                Team · Operations
              </div>
              <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>Workspace</h1>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
            {page === "tasks" && [
              { n: stats.dueSoon, l: "due ≤ 3 days", warn: stats.dueSoon > 0 },
              { n: stats.doing, l: "in progress" },
              { n: stats.done, l: "done" },
            ].map((s, i) => (
              <div
                key={i}
                title={filtered ? `Counting only: ${filterSummary}` : "Counting the whole board"}
                style={{ background: filtered ? C.accentSoft : C.surface, border: `1px solid ${filtered ? C.accent + "66" : C.line}`, borderRadius: 8, padding: "8px 14px", minWidth: 86, transition: "background-color .18s ease, border-color .18s ease" }}
              >
                <div style={{ fontSize: 22, fontWeight: 800, color: s.warn ? C.red : C.ink, lineHeight: 1.1 }}>{s.n}</div>
                <div style={{ fontFamily: mono, fontSize: 10, color: filtered ? C.accent : C.inkSoft, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {s.l}{filtered ? " · filtered" : ""}
                </div>
              </div>
            ))}

            {admin && (
              <>
                <button
                  onClick={() => setShowStats(true)}
                  title="Completion stats (admin)"
                  style={{
                    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8,
                    padding: "8px 12px", cursor: "pointer", fontFamily: mono, fontSize: 10.5,
                    letterSpacing: 0.5, textTransform: "uppercase", color: C.inkSoft,
                  }}
                >
                  ▤ Stats
                </button>
                <button
                  onClick={() => setShowAudit(true)}
                  title="Audit log (admin)"
                  style={{
                    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8,
                    padding: "8px 12px", cursor: "pointer", fontFamily: mono, fontSize: 10.5,
                    letterSpacing: 0.5, textTransform: "uppercase", color: C.inkSoft,
                  }}
                >
                  ≣ Audit
                </button>
              </>
            )}
            {owner && (
              <button
                onClick={() => setShowTeam(true)}
                title="Manage team, logins and roles (owner)"
                style={{
                  background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8,
                  padding: "8px 12px", cursor: "pointer", fontFamily: mono, fontSize: 10.5,
                  letterSpacing: 0.5, textTransform: "uppercase", color: C.inkSoft,
                }}
              >
                ⚙ Team
              </button>
            )}
            <button
              onClick={() => setShowAccount(true)}
              title="Account"
              style={{
                display: "flex", alignItems: "center", gap: 8, background: C.surface,
                border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px",
                cursor: "pointer", fontFamily: sans,
              }}
            >
              <Avatar m={me} size={26} />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                  {me.name}{admin ? " ★" : ""}
                </div>
                <div style={{ fontFamily: mono, fontSize: 9, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {roleLabel(myRole)}
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Page tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${C.line}`, overflowX: "auto" }}>
          {[
            ["home", "Home"],
            ["tasks", "Task management"],
            ["events", "Events"],
            ["debriefs", "Debriefs & performance"],
          ].map(([id, text]) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              style={{
                background: "transparent", border: "none", cursor: "pointer", fontFamily: sans,
                fontSize: 14, fontWeight: page === id ? 800 : 600, whiteSpace: "nowrap",
                color: page === id ? C.ink : C.inkSoft, padding: "8px 12px 10px",
                borderBottom: `3px solid ${page === id ? C.accent : "transparent"}`, marginBottom: -1,
              }}
            >
              {text}
            </button>
          ))}
        </div>

        {page === "home" && (
          <HomePage
            me={me} myRole={myRole} admin={admin} owner={owner} user={user}
            members={members} tasks={tasks} calEvents={calEvents} attendees={attendees}
            settings={settings} reloadSettings={reloadSettings} note={note} go={setPage}
          />
        )}
        {page === "events" && (
          <EventsPage
            me={me} admin={admin} teamAdmin={teamAdmin}
            members={activeMembers} allMembers={members} calEvents={calEvents} attendees={attendees}
            reloadCalendar={reloadCalendar} note={note}
          />
        )}
        {page === "debriefs" && (
          <DebriefsPage
            me={me} admin={admin} teamAdmin={teamAdmin} myRole={myRole}
            members={members} calEvents={calEvents} attendees={attendees}
            settings={settings} eventNames={eventNames} note={note}
          />
        )}

        {page === "tasks" && (<>
        {/* Workload */}
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px", marginBottom: 18 }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10 }}>
            Team workload · open tasks
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            {workload.map((w) => (
              <button
                key={w.id}
                onClick={() => togglePersonFilter(w.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: personFilter.includes(w.id) ? C.accentSoft : "transparent",
                  border: personFilter.includes(w.id) ? `1px solid ${C.accent}55` : "1px solid transparent",
                  borderRadius: 8, padding: "6px 8px", cursor: "pointer", textAlign: "left", fontFamily: sans,
                }}
              >
                <Avatar m={w} size={28} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>
                    {w.name}{w.id === me.id ? " (you)" : ""} <span style={{ color: C.inkSoft, fontWeight: 400 }}>· {w.open}</span>
                  </div>
                  <div style={{ height: 5, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${(w.open / maxLoad) * 100}%`, height: "100%", background: w.open >= maxLoad ? C.amber : w.color, borderRadius: 3, transition: "width .3s" }} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Filters + admin + add */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }}>
          {["All", ...eventNames].map((e) => {
            const isAll = e === "All";
            const active = isAll ? effectiveEventFilter.length === 0 : effectiveEventFilter.includes(e);
            const exec = !isAll && events.find((ev) => ev.name === e)?.executive;
            const isDropTarget = dragEvent && dragOverEvent === e && dragEvent !== e;
            return (
              <button
                key={e}
                onClick={() => (isAll ? setEventFilter([]) : toggleEventFilter(e))}
                draggable={admin && !isAll}
                onDragStart={admin && !isAll ? () => setDragEvent(e) : undefined}
                onDragEnd={admin ? () => { setDragEvent(null); setDragOverEvent(null); } : undefined}
                onDragOver={admin && dragEvent ? (ev) => { ev.preventDefault(); setDragOverEvent(e); } : undefined}
                onDragLeave={admin && dragEvent ? () => setDragOverEvent(null) : undefined}
                onDrop={admin && dragEvent ? (ev) => { ev.preventDefault(); reorderEvents(dragEvent, e); } : undefined}
                title={
                  exec
                    ? "Executive event — only execs can see it"
                    : admin && !isAll
                      ? "Click to filter · drag to reorder"
                      : undefined
                }
                style={{
                  fontFamily: mono, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase",
                  padding: "6px 12px", borderRadius: 20,
                  cursor: admin && !isAll ? "grab" : "pointer",
                  background: active ? C.ink : C.surface,
                  color: active ? "#fff" : C.inkSoft,
                  border: `1px ${exec ? "dashed" : "solid"} ${active ? C.ink : exec ? C.inkSoft : C.line}`,
                  opacity: dragEvent === e ? 0.4 : 1,
                  boxShadow: isDropTarget ? `-3px 0 0 0 ${C.accent}` : "none",
                }}
              >
                {e}{exec ? " ◆" : ""}
              </button>
            );
          })}
          {admin && (
            <>
              <button
                onClick={() => setShowEvents(true)}
                title="Manage events (admin)"
                style={{
                  fontFamily: mono, fontSize: 11, padding: "6px 12px", borderRadius: 20,
                  cursor: "pointer", background: C.accentSoft, color: C.accent,
                  border: `1px dashed ${C.accent}88`, letterSpacing: 0.5, textTransform: "uppercase",
                }}
              >
                ✎ Edit events
              </button>
              <button
                onClick={() => setShowArchive(true)}
                title="Archived tasks (admin)"
                style={{
                  fontFamily: mono, fontSize: 11, padding: "6px 12px", borderRadius: 20,
                  cursor: "pointer", background: C.accentSoft, color: C.accent,
                  border: `1px dashed ${C.accent}88`, letterSpacing: 0.5, textTransform: "uppercase",
                }}
              >
                ⌸ Archive
              </button>
              <label
                title="Show only executive tasks (admin)"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  fontFamily: mono, fontSize: 11, padding: "6px 12px", borderRadius: 20,
                  cursor: "pointer", letterSpacing: 0.5, textTransform: "uppercase",
                  background: execFilter ? C.ink : C.surface,
                  color: execFilter ? "#fff" : C.inkSoft,
                  border: `1px solid ${execFilter ? C.ink : C.line}`,
                  transition: "background-color .18s ease, color .18s ease, border-color .18s ease",
                }}
              >
                <input
                  type="checkbox"
                  checked={execFilter}
                  onChange={(e) => setExecFilter(e.target.checked)}
                  style={{ width: 13, height: 13, accentColor: C.accent, cursor: "pointer", margin: 0 }}
                />
                Executive tasks
              </label>
            </>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => exportBoard().catch(() => note("Export failed — try again", true))}
            title="Download the board as shown (filters applied) as a spreadsheet"
            style={{
              background: C.surface, color: C.accent, border: `1px solid ${C.accent}55`, borderRadius: 8,
              padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: sans,
            }}
          >
            ⭳ Export board
          </button>
          {syncNote && (
            <span style={{ fontFamily: mono, fontSize: 11, color: syncNote.includes("fail") || syncNote.includes("Couldn't") ? C.red : C.accent }}>
              {syncNote}
            </span>
          )}
          <button
            onClick={() => setEditing("new")}
            style={{
              background: C.accent, color: "#fff", border: "none", borderRadius: 8,
              padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: sans,
            }}
          >
            + Add task
          </button>
        </div>

        {filtered && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "-6px 0 14px", fontSize: 12.5, color: C.accent }}>
            <span>
              Showing <b>{visible.length}</b> of {tasks.length} tasks · {filterSummary}
            </span>
            <button
              onClick={() => { setEventFilter([]); setPersonFilter([]); setExecFilter(false); }}
              style={{ background: "transparent", border: "none", color: C.accent, textDecoration: "underline", cursor: "pointer", fontSize: 12.5, fontFamily: sans, padding: 0 }}
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Board */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {COLUMNS.map((col) => {
            const colTasks = visible.filter((t) => t.col === col.id);
            return (
              <div
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); setHoverCol(col.id); }}
                onDragLeave={() => setHoverCol(null)}
                onDrop={() => drop(col.id)}
                style={{
                  background: hoverCol === col.id ? C.accentSoft : "#EBEDF1",
                  border: `1.5px ${hoverCol === col.id ? "dashed " + C.accent : "solid transparent"}`,
                  borderRadius: 10, padding: 10, minHeight: 220, transition: "background .15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 6px 10px" }}>
                  <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: C.inkSoft }}>
                    {col.label}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: C.inkSoft }}>{colTasks.length}</span>
                </div>

                {colTasks.length === 0 && (
                  <div style={{ fontFamily: mono, fontSize: 11, color: C.inkSoft, textAlign: "center", padding: "24px 8px", opacity: 0.7 }}>
                    Drag a task here
                  </div>
                )}

                {colTasks.map((t) => {
                  const p = PRIORITIES[t.priority] || PRIORITIES.normal;
                  const due = dueMeta(t);
                  const assigned = taskAssignees(t).map((id) => member(members, id));
                  return (
                    <div
                      key={t.id}
                      draggable
                      className="app-card"
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => { setDragId(null); setHoverCol(null); }}
                      onClick={() => setEditing(t)}
                      style={{
                        background: C.surface, borderRadius: 8, padding: "10px 12px", marginBottom: 8,
                        border: `1px solid ${C.line}`, borderLeft: `3px solid ${p.color}`,
                        cursor: "grab", opacity: dragId === t.id ? 0.4 : 1,
                        boxShadow: "0 1px 2px rgba(30,34,48,0.05)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                        <Tag text={t.event} />
                        <span style={{ fontFamily: mono, fontSize: 10, color: p.color, background: p.soft, padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          {p.label}
                        </span>
                        {t.executive && (
                          <span style={{ fontFamily: mono, fontSize: 10, color: "#fff", background: C.ink, padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                            Exec
                          </span>
                        )}
                        {t.links?.length > 0 && (
                          <span title={`${t.links.length} linked file${t.links.length === 1 ? "" : "s"}`} style={{ fontFamily: mono, fontSize: 10, color: C.inkSoft, background: C.bg, padding: "2px 7px", borderRadius: 3, letterSpacing: 0.5 }}>
                            ⎘ {t.links.length}
                          </span>
                        )}
                        {t.repeat_every && (
                          <span title={repeatLabel(t.repeat_every)} style={{ fontFamily: mono, fontSize: 10, color: C.inkSoft, background: C.bg, padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                            ↻ {t.repeat_every}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginBottom: 10, textDecoration: t.col === "done" ? "line-through" : "none", color: t.col === "done" ? C.inkSoft : C.ink }}>
                        {t.title}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ display: "inline-flex" }}>
                            {assigned.slice(0, 3).map((m, i) => (
                              <span key={m.id} style={{ marginLeft: i === 0 ? 0 : -7, border: `2px solid ${C.surface}`, borderRadius: "50%", display: "inline-flex" }}>
                                <Avatar m={m} size={22} />
                              </span>
                            ))}
                          </span>
                          <span style={{ fontSize: 12, color: C.inkSoft }}>
                            {assigned.length === 1
                              ? assigned[0].name
                              : assigned.length === 2
                                ? `${assigned[0].name} & ${assigned[1].name}`
                                : `${assigned[0].name} +${assigned.length - 1}`}
                          </span>
                        </div>
                        <span style={{ fontFamily: mono, fontSize: 10.5, color: due.color, background: due.soft, padding: "2px 7px", borderRadius: 3 }}>
                          {due.text}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        </>)}

      </div>

      {editing && (
        <TaskModal
          task={editing === "new" ? null : editing}
          defaultAssigner={me.id !== "?" ? me.id : null}
          eventNames={eventNames}
          members={activeMembers}
          admin={admin}
          onSave={saveTask}
          onDelete={deleteTask}
          onArchive={archiveTask}
          onClose={() => setEditing(null)}
        />
      )}

      {completing && (
        <CompletionModal
          title={completing.title}
          onDone={(extra) => { const fn = completing.apply; setCompleting(null); fn(extra); }}
          onCancel={() => setCompleting(null)}
        />
      )}

      {showAccount && (
        <AccountModal user={user} me={me} role={myRole} onSignOut={signOut} onClose={() => setShowAccount(false)} />
      )}

      {showEvents && admin && (
        <EventsModal events={sortedEvents} note={note} onClose={() => setShowEvents(false)} />
      )}

      {showArchive && admin && (
        <ArchiveModal members={members} note={note} onClose={() => setShowArchive(false)} />
      )}

      {showStats && admin && (
        <StatsModal members={members} owner={owner} note={note} onClose={() => setShowStats(false)} />
      )}


      {showTeam && owner && (
        <TeamModal
          members={members}
          roles={roles}
          user={user}
          note={note}
          reloadRoles={reloadRoles}
          onClose={() => setShowTeam(false)}
        />
      )}
    </div>
  );
}

// ==================================================================
// Events manager (admins only)
// ==================================================================
function EventsModal({ events, note, onClose }) {
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameText, setRenameText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // event object

  const addEvent = async () => {
    const name = newName.trim();
    if (!name) return;
    if (events.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      return note("That event already exists", true);
    }
    setBusy(true);
    const nextOrder = Math.max(0, ...events.map((e) => e.sort_order || 0)) + 1;
    const { error } = await supabase
      .from("events")
      .insert({ name, sort_order: nextOrder });
    setBusy(false);
    if (error) note("Couldn't add event — admin access needed", true);
    else {
      setNewName("");
      note("Event added ✓");
    }
  };

  const startRename = (e) => {
    setRenamingId(e.id);
    setRenameText(e.name);
  };

  const applyRename = async (ev) => {
    const name = renameText.trim();
    setRenamingId(null);
    if (!name || name === ev.name) return;
    if (events.some((e) => e.id !== ev.id && e.name.toLowerCase() === name.toLowerCase())) {
      return note("An event with that name already exists", true);
    }
    setBusy(true);
    // Rename the event, then carry all its tasks across to the new name
    const { error: e1 } = await supabase.from("events").update({ name }).eq("id", ev.id);
    if (e1) {
      setBusy(false);
      return note("Rename failed — admin access needed", true);
    }
    const { error: e2 } = await supabase.from("tasks").update({ event: name }).eq("event", ev.name);
    setBusy(false);
    if (e2) note("Event renamed, but some tasks may still show the old name", true);
    else note("Event renamed ✓");
  };

  const deleteEvent = async (ev) => {
    setConfirmDelete(null);
    setBusy(true);
    const { error } = await supabase.from("events").delete().eq("id", ev.id);
    setBusy(false);
    if (error) note("Delete failed — admin access needed", true);
    else note("Event deleted ✓");
  };

  const input = {
    flex: 1, padding: "9px 10px", borderRadius: 7, border: `1px solid ${C.line}`,
    fontSize: 13.5, fontFamily: sans, color: C.ink, background: "#fff", boxSizing: "border-box",
  };

  return (
    <div
      onClick={onClose}
      className="app-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(30,34,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="app-modal" style={{ background: C.surface, borderRadius: 12, padding: 22, width: "100%", maxWidth: 420, fontFamily: sans, maxHeight: "85vh", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 2px", fontSize: 18, fontWeight: 800, color: C.ink }}>Manage events</h2>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>
          Renaming an event also updates its tasks. Deleting an event keeps its tasks (visible under "All").
        </p>

        {events.map((ev) => (
          <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
            {renamingId === ev.id ? (
              <>
                <input
                  style={input}
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyRename(ev)}
                  autoFocus
                />
                <button onClick={() => applyRename(ev)} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 7, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>
                  Save
                </button>
                <button onClick={() => setRenamingId(null)} style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, cursor: "pointer", fontFamily: sans }}>
                  ✕
                </button>
              </>
            ) : confirmDelete?.id === ev.id ? (
              <>
                <span style={{ flex: 1, fontSize: 13, color: C.ink }}>
                  Delete <b>{ev.name}</b>?
                </span>
                <button onClick={() => deleteEvent(ev)} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 7, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>
                  Yes, delete
                </button>
                <button onClick={() => setConfirmDelete(null)} style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, cursor: "pointer", fontFamily: sans }}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <Tag text={ev.name} />
                {ev.executive && (
                  <span style={{ fontFamily: mono, fontSize: 10, color: "#fff", background: C.ink, padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Exec
                  </span>
                )}
                <div style={{ flex: 1 }} />
                <button onClick={() => startRename(ev)} disabled={busy} style={{ background: "transparent", color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                  Rename
                </button>
                <button onClick={() => setConfirmDelete(ev)} disabled={busy} style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}44`, borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                  Delete
                </button>
              </>
            )}
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <input
            style={input}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEvent()}
            placeholder="New event name…"
          />
          <button
            onClick={addEvent}
            disabled={busy || !newName.trim()}
            style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: sans, opacity: newName.trim() ? 1 : 0.5 }}
          >
            + Add
          </button>
        </div>
        <button onClick={onClose} style={{ width: "100%", marginTop: 16, background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
          Close
        </button>
      </div>
    </div>
  );
}

// ==================================================================
// Account modal
// ==================================================================
function AccountModal({ user, me, role, onSignOut, onClose }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // ---- Two-factor authentication (optional, per user) ----
  const [totpFactor, setTotpFactor] = useState(undefined); // undefined = loading, null = none
  const [enroll, setEnroll] = useState(null); // { id, qr, secret } while setting up
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState(null);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const loadFactors = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setTotpFactor((data?.totp || []).find((f) => f.status === "verified") || null);
  };
  useEffect(() => { loadFactors(); }, []);

  const startEnroll = async () => {
    setMfaMsg(null);
    setBusy(true);
    // Clear any abandoned half-finished enrolments first
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all || []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data: e, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    setBusy(false);
    if (error) return setMfaMsg({ ok: false, text: error.message });
    setEnroll({ id: e.id, qr: e.totp.qr_code, secret: e.totp.secret });
  };

  const confirmEnroll = async () => {
    if (mfaCode.length < 6) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enroll.id,
      code: mfaCode.trim(),
    });
    setBusy(false);
    if (error) {
      setMfaMsg({ ok: false, text: "That code didn't work — try the next one from your app." });
      setMfaCode("");
    } else {
      setEnroll(null);
      setMfaCode("");
      setMfaMsg({ ok: true, text: "2FA enabled ✓ — you'll be asked for a code at every sign-in." });
      loadFactors();
    }
  };

  const disableMfa = async () => {
    setConfirmDisable(false);
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: totpFactor.id });
    setBusy(false);
    if (error) setMfaMsg({ ok: false, text: error.message });
    else {
      setMfaMsg({ ok: true, text: "2FA disabled." });
      loadFactors();
    }
  };

  const requestChange = () => {
    setMsg(null);
    if (pw1.length < 8) return setMsg({ ok: false, text: "Password must be at least 8 characters." });
    if (pw1 !== pw2) return setMsg({ ok: false, text: "Passwords don't match." });
    setConfirming(true);
  };

  const changePassword = async () => {
    setConfirming(false);
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else {
      setMsg({ ok: true, text: "Password updated ✓" });
      setPw1("");
      setPw2("");
    }
  };

  const input = {
    width: "100%", padding: "10px 11px", borderRadius: 8, border: `1px solid ${C.line}`,
    fontSize: 13.5, fontFamily: sans, color: C.ink, background: "#fff", boxSizing: "border-box",
  };
  const label = { fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, display: "block", marginBottom: 5, marginTop: 12 };

  return (
    <div
      onClick={onClose}
      className="app-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(30,34,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="app-modal" style={{ background: C.surface, borderRadius: 12, padding: 22, width: "100%", maxWidth: 380, fontFamily: sans }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <Avatar m={me} size={38} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>
              {me.name} · {roleLabel(role)}{role === "owner" || role === "admin" ? " ★" : ""}
            </div>
            <div style={{ fontSize: 12, color: C.inkSoft }}>{user.email}</div>
          </div>
        </div>

        <label style={label}>New password</label>
        <input style={input} type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="At least 8 characters" />

        <label style={label}>Confirm new password</label>
        <input style={input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />

        {msg && (
          <div style={{ marginTop: 10, background: msg.ok ? C.accentSoft : C.redSoft, border: `1px solid ${msg.ok ? C.accent : C.red}44`, color: C.ink, borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}>
            {msg.text}
          </div>
        )}

        {confirming ? (
          <div style={{ marginTop: 14, background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>
              Change your password now? Your old password stops working immediately.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={changePassword} disabled={busy} style={{ flex: 1, background: C.red, color: "#fff", border: "none", borderRadius: 7, padding: "9px 0", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>
                Yes, change it
              </button>
              <button onClick={() => setConfirming(false)} style={{ flex: 1, background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 7, padding: "9px 0", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={requestChange}
            disabled={busy}
            style={{ width: "100%", marginTop: 14, background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: sans, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Updating…" : "Change password"}
          </button>
        )}

        {/* ---- Two-factor authentication ---- */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, marginBottom: 8 }}>
            Two-factor authentication
          </div>

          {mfaMsg && (
            <div style={{ marginBottom: 10, background: mfaMsg.ok ? C.accentSoft : C.redSoft, border: `1px solid ${mfaMsg.ok ? C.accent : C.red}44`, color: C.ink, borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}>
              {mfaMsg.text}
            </div>
          )}

          {enroll ? (
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: "0 0 10px", fontSize: 12.5, color: C.inkSoft, textAlign: "left", lineHeight: 1.5 }}>
                Scan this with your authenticator app (Google Authenticator, Authy,
                or your phone's built-in one), then enter the 6-digit code it shows.
              </p>
              <img src={enroll.qr} alt="2FA QR code" style={{ width: 164, height: 164, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: 6 }} />
              <div style={{ fontFamily: mono, fontSize: 10.5, color: C.inkSoft, margin: "8px 0 10px", wordBreak: "break-all" }}>
                Can't scan? Enter manually: {enroll.secret}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 16, fontFamily: mono, letterSpacing: 4, textAlign: "center", color: C.ink, background: "#fff", boxSizing: "border-box" }}
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && confirmEnroll()}
                  placeholder="••••••"
                />
                <button onClick={confirmEnroll} disabled={busy || mfaCode.length < 6} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "0 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: sans, opacity: mfaCode.length < 6 ? 0.5 : 1 }}>
                  Confirm
                </button>
              </div>
              <button onClick={() => { setEnroll(null); setMfaCode(""); }} style={{ marginTop: 8, background: "transparent", color: C.inkSoft, border: "none", fontSize: 12, cursor: "pointer", fontFamily: sans, textDecoration: "underline" }}>
                Cancel setup
              </button>
            </div>
          ) : totpFactor === undefined ? (
            <div style={{ fontFamily: mono, fontSize: 11, color: C.inkSoft }}>Loading…</div>
          ) : totpFactor ? (
            confirmDisable ? (
              <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>
                  Turn off 2FA? Your account will only be protected by your password.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={disableMfa} disabled={busy} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>
                    Yes, disable
                  </button>
                  <button onClick={() => setConfirmDisable(false)} style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 7, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, fontSize: 13, color: C.ink }}>2FA is <b>on</b> ✓</span>
                <button onClick={() => setConfirmDisable(true)} disabled={busy} style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}44`, borderRadius: 7, padding: "7px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                  Disable
                </button>
              </div>
            )
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12.5, color: C.inkSoft }}>
                Add a 6-digit code check at sign-in (authenticator app).
              </span>
              <button onClick={startEnroll} disabled={busy} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 7, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>
                Enable 2FA
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={{ flex: 1, background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
            Close
          </button>
          <button onClick={onSignOut} style={{ flex: 1, background: "transparent", color: C.red, border: `1px solid ${C.red}55`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================================================================
// Task modal
// ==================================================================
function TaskModal({ task, defaultAssigner, eventNames, members, admin, onSave, onDelete, onArchive, onClose }) {
  // Include the task's current event even if it was deleted from the list,
  // so editing an old task doesn't silently change its event.
  const options =
    task && task.event && !eventNames.includes(task.event)
      ? [task.event, ...eventNames]
      : eventNames;

  const [f, setF] = useState(
    task
      ? { ...task, assignees: taskAssignees(task) }
      : {
          title: "",
          // Default to the General event when it exists
          event: eventNames.find((n) => n.toLowerCase() === "general") || eventNames[0] || "",
          assignees: [], // deliberately empty — the creator picks explicitly
          assigner: defaultAssigner, // whoever is creating the task, changeable below
          priority: "normal",
          due: plusDays(7),
          col: "todo",
          executive: false,
          description: "",
          repeat_every: null,
        }
  );
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  // File links: one per line in the form, stored as text[]
  const [linksText, setLinksText] = useState((task?.links || []).join("\n"));
  const parsedLinks = linksText.split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean);
  const badLink = parsedLinks.find((l) => !/^https?:\/\//i.test(l));
  const canSave = f.title.trim() && f.event && f.assignees.length > 0 && !badLink;
  const toggleAssignee = (id) =>
    setF((p) => ({
      ...p,
      assignees: p.assignees.includes(id)
        ? p.assignees.filter((a) => a !== id) // may go to zero; save stays disabled until ≥1
        : [...p.assignees, id],
    }));

  const input = {
    width: "100%", padding: "9px 10px", borderRadius: 7, border: `1px solid ${C.line}`,
    fontSize: 13.5, fontFamily: sans, color: C.ink, background: "#fff", boxSizing: "border-box",
  };
  const label = { fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, display: "block", marginBottom: 5, marginTop: 12 };

  return (
    <div
      onClick={onClose}
      className="app-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(30,34,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="app-modal" style={{ background: C.surface, borderRadius: 12, padding: 22, width: "100%", maxWidth: 420, fontFamily: sans, maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.ink }}>{task ? "Edit task" : "New task"}</h2>

        <label style={label}>Task</label>
        <input style={input} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Print event badges" autoFocus />

        <label style={label}>Description (optional)</label>
        <textarea
          style={{ ...input, minHeight: 64, resize: "vertical", fontFamily: sans }}
          value={f.description || ""}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Extra details, links, requirements…"
        />

        <label style={label}>Files / links (optional, one per line)</label>
        <textarea
          style={{ ...input, minHeight: 44, resize: "vertical", fontFamily: sans, fontSize: 12.5 }}
          value={linksText}
          onChange={(e) => setLinksText(e.target.value)}
          placeholder="https://drive.google.com/…"
        />
        {badLink && (
          <div style={{ marginTop: 6, fontSize: 12, color: C.red }}>Links need to start with https:// — “{badLink}”</div>
        )}
        {task && (task.links || []).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
            {task.links.map((l) => (
              <a key={l} href={l} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ⎘ {l}
              </a>
            ))}
          </div>
        )}

        <label style={label}>Assignees — pick one or more</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {members.map((m) => {
            const on = f.assignees.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggleAssignee(m.id)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "5px 10px 5px 6px", borderRadius: 16, cursor: "pointer",
                  fontSize: 12.5, fontWeight: 600, fontFamily: sans,
                  background: on ? C.accentSoft : "#fff",
                  color: on ? C.accent : C.inkSoft,
                  border: `1px solid ${on ? C.accent : C.line}`,
                }}
              >
                <Avatar m={m} size={20} />{m.name}{on ? " ✓" : ""}
              </button>
            );
          })}
        </div>
        {f.assignees.length === 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: C.red }}>Pick at least one assignee.</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={label}>Event</label>
            <select style={input} value={f.event} onChange={(e) => set("event", e.target.value)}>
              {options.map((ev) => <option key={ev}>{ev}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Assigned by</label>
            <select style={input} value={f.assigner || ""} onChange={(e) => set("assigner", e.target.value || null)}>
              {!f.assigner && <option value="">—</option>}
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Priority</label>
            <select style={input} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
              {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Due date</label>
            <input type="date" style={input} value={f.due} onChange={(e) => set("due", e.target.value)} />
          </div>
          <div>
            <label style={label}>Repeats</label>
            <select style={input} value={f.repeat_every || ""} onChange={(e) => set("repeat_every", e.target.value || null)}>
              {REPEATS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        </div>
        {f.repeat_every && (
          <div style={{ marginTop: 8, fontSize: 12, color: C.inkSoft, lineHeight: 1.5 }}>
            When this is marked Done, the next one ({repeatLabel(f.repeat_every).toLowerCase()})
            is created automatically with the same details.
          </div>
        )}

        {admin && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, cursor: "pointer", fontSize: 13, color: C.ink, fontFamily: sans }}>
            <input
              type="checkbox"
              checked={!!f.executive}
              onChange={(e) => set("executive", e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.accent, cursor: "pointer" }}
            />
            <span>
              <b>Executive</b>
              <span style={{ color: C.inkSoft }}> — only execs (admins & owners) can see this task</span>
            </span>
          </label>
        )}

        <label style={label}>Column</label>
        <div style={{ display: "flex", gap: 6 }}>
          {COLUMNS.map((c) => (
            <button
              key={c.id}
              onClick={() => set("col", c.id)}
              style={{
                flex: 1, padding: "7px 0", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: sans,
                background: f.col === c.id ? C.ink : "#fff", color: f.col === c.id ? "#fff" : C.inkSoft,
                border: `1px solid ${f.col === c.id ? C.ink : C.line}`,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {task && admin && (
            <button onClick={() => onDelete(task.id)} style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}55`, borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
              Delete
            </button>
          )}
          {task && admin && (
            <button
              onClick={() => onArchive(task.id)}
              title="Remove from the board but keep all data (admins can restore it later)"
              style={{ background: "transparent", color: C.accent, border: `1px solid ${C.accent}55`, borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}
            >
              Archive
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
            Cancel
          </button>
          <button
            onClick={() => canSave && onSave({ ...f, links: parsedLinks.length ? parsedLinks : null })}
            style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: sans, opacity: canSave ? 1 : 0.5 }}
          >
            {task ? "Save changes" : "Add task"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================================================================
// Archived tasks (admins only)
// ==================================================================
function ArchiveModal({ members, note, onClose }) {
  const [rows, setRows] = useState(null); // null = loading
  const [confirmDelete, setConfirmDelete] = useState(null); // task id
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false });
    if (error) {
      note("Couldn't load the archive — admin access needed", true);
      setRows([]);
    } else setRows(data);
  };
  useEffect(() => { load(); }, []);

  const restore = async (t) => {
    setBusy(true);
    const { error } = await supabase
      .from("tasks")
      .update({ archived_at: null, archived_by: null })
      .eq("id", t.id);
    setBusy(false);
    if (error) note("Restore failed — try again", true);
    else {
      setRows((rs) => rs.filter((r) => r.id !== t.id));
      note("Restored to the board ✓");
    }
  };

  const destroy = async (t) => {
    setConfirmDelete(null);
    setBusy(true);
    const { error } = await supabase.from("tasks").delete().eq("id", t.id);
    setBusy(false);
    if (error) note("Delete failed — try again", true);
    else {
      setRows((rs) => rs.filter((r) => r.id !== t.id));
      note("Deleted forever ✓");
    }
  };

  return (
    <div
      onClick={onClose}
      className="app-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(30,34,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="app-modal" style={{ background: C.surface, borderRadius: 12, padding: 22, width: "100%", maxWidth: 560, fontFamily: sans, maxHeight: "85vh", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 2px", fontSize: 18, fontWeight: 800, color: C.ink }}>Archived tasks</h2>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>
          Archived tasks are hidden from the board but keep all their data. Restore puts a task back; Delete forever cannot be undone.
        </p>

        {rows === null && (
          <div style={{ fontFamily: mono, fontSize: 11, color: C.inkSoft, textAlign: "center", padding: "18px 0" }}>Loading…</div>
        )}
        {rows && rows.length === 0 && (
          <div style={{ fontFamily: mono, fontSize: 11, color: C.inkSoft, textAlign: "center", padding: "18px 0" }}>Nothing archived yet.</div>
        )}

        {rows && rows.map((t) => {
          const assigned = taskAssignees(t).map((id) => member(members, id));
          return (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ display: "inline-flex" }}>
                {assigned.slice(0, 3).map((m, i) => (
                  <span key={m.id} style={{ marginLeft: i === 0 ? 0 : -8, border: `2px solid ${C.surface}`, borderRadius: "50%", display: "inline-flex" }}>
                    <Avatar m={m} size={26} />
                  </span>
                ))}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{t.title}</div>
                <div style={{ fontSize: 11.5, color: C.inkSoft, marginTop: 2 }}>
                  <Tag text={t.event} />{" "}
                  archived {new Date(t.archived_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  {t.archived_by ? ` by ${memberNameForEmail(members, t.archived_by)}` : ""}
                </div>
              </div>
              {confirmDelete === t.id ? (
                <>
                  <button onClick={() => destroy(t)} disabled={busy} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 7, padding: "7px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>
                    Yes, delete forever
                  </button>
                  <button onClick={() => setConfirmDelete(null)} style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 12, cursor: "pointer", fontFamily: sans }}>
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => restore(t)} disabled={busy} style={{ background: "transparent", color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 7, padding: "7px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                    Restore
                  </button>
                  <button onClick={() => setConfirmDelete(t.id)} disabled={busy} style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}44`, borderRadius: 7, padding: "7px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                    Delete forever
                  </button>
                </>
              )}
            </div>
          );
        })}

        <button onClick={onClose} style={{ width: "100%", marginTop: 16, background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
          Close
        </button>
      </div>
    </div>
  );
}

// ==================================================================
// Completion stats (admins only)
// ==================================================================
function StatsModal({ members, owner, note, onClose }) {
  const [allRows, setAllRows] = useState(null); // null = loading
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  // Report period. Start = when the task was assigned, end = when it was
  // marked complete. Blank = no limit on that side.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [taskRows, setTaskRows] = useState([]); // incl. archived — for "tasks assigned"

  useEffect(() => {
    (async () => {
      const [c, t] = await Promise.all([
        supabase.from("task_completions").select("*").order("completed_at", { ascending: false }),
        supabase.from("tasks").select("id, assignee, assignees, created_at"),
      ]);
      if (c.error) {
        note("Couldn't load stats — admin access needed", true);
        setAllRows([]);
      } else {
        setAllRows(c.data);
        setTaskRows(t.data || []);
      }
    })();
  }, []);

  const fromT = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
  const toT = to ? new Date(to + "T23:59:59").getTime() : Infinity;
  const ranged = !!(from || to);
  const rows = useMemo(
    () =>
      allRows &&
      allRows.filter(
        (r) => new Date(r.task_created_at).getTime() >= fromT && new Date(r.completed_at).getTime() <= toT
      ),
    [allRows, fromT, toT]
  );
  const allTasks = useMemo(
    () => taskRows.filter((t) => { const c = new Date(t.created_at).getTime(); return c >= fromT && c <= toT; }),
    [taskRows, fromT, toT]
  );
  const periodText = ranged
    ? `${from ? fmtDate(from) : "the start"} – ${to ? fmtDate(to) : "today"}`
    : "All time";

  // "Standing" completions are ones not later reopened — the real record.
  const standing = useMemo(() => (rows || []).filter((r) => !r.reopened), [rows]);
  const reopens = useMemo(() => (rows || []).filter((r) => r.reopened).length, [rows]);

  // Every member gets a section, even with zero completions.
  // Completion is attributed to the ASSIGNEES (everyone the task belonged to).
  const perMember = useMemo(() => {
    return members.map((m) => {
      const mine = standing.filter((r) => taskAssignees(r).includes(m.id));
      const onTime = mine.filter((r) => r.on_time).length;
      // "Assigned" = every distinct task that has ever included them, counting
      // live tasks (incl. archived) plus completions whose task is now deleted.
      const liveIds = new Set(
        allTasks.filter((t) => taskAssignees(t).includes(m.id)).map((t) => t.id)
      );
      (rows || []).forEach((r) => {
        if (taskAssignees(r).includes(m.id)) liveIds.add(r.task_id);
      });
      return {
        ...m,
        rows: mine,
        assigned: liveIds.size,
        done: mine.length,
        onTimePct: mine.length ? Math.round((onTime / mine.length) * 100) : null,
        avgDays: mine.length
          ? (mine.reduce((s, r) => s + r.days_to_complete, 0) / mine.length).toFixed(1)
          : null,
        reopens: (rows || []).filter((r) => r.reopened && taskAssignees(r).includes(m.id)).length,
      };
    });
  }, [standing, members, rows, allTasks]);

  const totalOnTimePct = standing.length
    ? Math.round((standing.filter((r) => r.on_time).length / standing.length) * 100)
    : null;

  const stamp = () => new Date().toISOString().slice(0, 10);

  // Individual stats — one table per member, one row per completed task
  const MEMBER_TABLE_HEADERS = [
    "Task", "Date assigned", "Date completed", "Date due",
    "Minutes taken", "Days to mark complete", "Notes",
  ];
  const memberTableRows = (m) =>
    m.rows.map((r) => [
      r.title,
      fmtDate(r.task_created_at),
      fmtDate(r.completed_at),
      fmtDate(r.due),
      r.minutes_worked ?? "—",
      r.days_to_complete,
      r.completion_notes || "—",
    ]);
  const memberStatLine = (m) =>
    m.done === 0
      ? `${m.assigned} assigned · none completed yet`
      : `${m.assigned} assigned · ${m.done} completed · ${m.onTimePct}% on time`;

  // Recap table at the top of both reports: TOTAL row, then one row per member
  const RECAP_HEADERS = ["Name", "Tasks assigned", "Tasks completed", "% on time", "Reopened"];
  // Distinct tasks overall — shared tasks count once, not once per assignee
  const totalAssigned = useMemo(() => {
    const ids = new Set(allTasks.map((t) => t.id));
    (rows || []).forEach((r) => ids.add(r.task_id));
    return ids.size;
  }, [allTasks, rows]);

  const recapRows = () => [
    [
      "TOTAL (distinct tasks)",
      totalAssigned,
      standing.length,
      totalOnTimePct === null ? "—" : `${totalOnTimePct}%`,
      reopens,
    ],
    ...perMember.map((m) => [
      m.name, m.assigned, m.done,
      m.onTimePct === null ? "—" : `${m.onTimePct}%`,
      m.reopens,
    ]),
  ];

  // Styled Excel workbook: Summary sheet + raw data sheet.
  // exceljs is lazy-loaded so it doesn't weigh down the normal board bundle.
  const downloadExcel = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ACCENT = "FF4C5FD5", SOFT = "FFECEEFB", INK = "FF1E2230";
    const styleHeader = (row) => {
      row.eachCell((c) => {
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
        c.alignment = { vertical: "middle" };
      });
      row.height = 20;
    };
    const addTable = (ws, title, headers, data) => {
      const tRow = ws.addRow([title]);
      tRow.getCell(1).font = { bold: true, size: 13, color: { argb: INK } };
      styleHeader(ws.addRow(headers));
      data.forEach((r, i) => {
        const row = ws.addRow(r);
        if (i % 2 === 1)
          row.eachCell((c) => {
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
          });
      });
      ws.addRow([]);
    };

    const sum = wb.addWorksheet("Summary");
    sum.columns = [{ width: 26 }, { width: 15 }, { width: 16 }, { width: 11 }, { width: 11 }];
    const title = sum.addRow(["Workspace — Completion Report"]);
    title.getCell(1).font = { bold: true, size: 15, color: { argb: ACCENT } };
    sum.addRow([`Generated ${fmtDate(new Date())} · Period: ${periodText}`]);
    sum.addRow([]);
    addTable(sum, "Recap", RECAP_HEADERS, recapRows());
    // Bold the TOTAL row (first data row of the recap table)
    sum.getRow(6).eachCell((c) => { c.font = { bold: true, color: { argb: INK } }; });

    // One sheet per member — included even with no completions
    const usedNames = new Set(["summary"]);
    perMember.forEach((m) => {
      let name = m.name.replace(/[\\/*?:[\]]/g, "").slice(0, 28) || m.id;
      while (usedNames.has(name.toLowerCase())) name += "_";
      usedNames.add(name.toLowerCase());
      const ws = wb.addWorksheet(name);
      ws.columns = [
        { width: 38 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 14 },
        { width: 21 }, { width: 44 },
      ];
      const t = ws.addRow([m.name]);
      t.getCell(1).font = { bold: true, size: 14, color: { argb: ACCENT } };
      ws.addRow([memberStatLine(m)]);
      ws.addRow([]);
      if (m.rows.length) {
        styleHeader(ws.addRow(MEMBER_TABLE_HEADERS));
        memberTableRows(m).forEach((r, i) => {
          const row = ws.addRow(r);
          if (i % 2 === 1)
            row.eachCell((c) => {
              c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
            });
        });
      } else {
        ws.addRow(["No completed tasks yet."]);
      }
    });

    const buf = await wb.xlsx.writeBuffer();
    saveBlob(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `app-task-stats-${stamp()}.xlsx`
    );
  };

  // Self-contained styled HTML report (printable to PDF from the browser)
  const downloadHtml = () => {
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const table = (headers, data, cls = "") =>
      `<table${cls ? ` class="${cls}"` : ""}><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` +
      `<tbody>${data.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Completion report ${stamp()}</title>
<style>
  body { font-family: 'Avenir Next','Segoe UI',system-ui,sans-serif; color:#1E2230; background:#F5F6F8; margin:0; padding:32px; }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { color:#4C5FD5; font-size:24px; margin:0 0 4px; }
  .sub { color:#646B7A; font-size:13px; margin-bottom:24px; }
  h2 { font-size:15px; margin:28px 0 8px; letter-spacing:.5px; text-transform:uppercase; color:#646B7A; }
  .tiles { display:flex; gap:12px; flex-wrap:wrap; }
  .tile { background:#fff; border:1px solid #DFE2E8; border-radius:10px; padding:12px 18px; min-width:120px; }
  .tile b { display:block; font-size:26px; }
  .tile span { font-size:11px; color:#646B7A; text-transform:uppercase; letter-spacing:.5px; }
  table { width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 1px 2px rgba(30,34,48,.06); }
  th { background:#4C5FD5; color:#fff; text-align:left; font-size:12px; padding:9px 12px; }
  td { font-size:13px; padding:8px 12px; border-top:1px solid #ECEEFB; }
  tr:nth-child(even) td { background:#FAFBFC; }
  .recap tr:first-child td { font-weight:700; }
  @media print { body { background:#fff; padding:0; } }
</style></head><body><div class="wrap">
<h1>Workspace — Completion Report</h1>
<div class="sub">Generated ${esc(fmtDate(new Date()))} · Period: ${esc(periodText)}</div>
<div class="tiles">
  <div class="tile"><b>${standing.length}</b><span>tasks completed</span></div>
  <div class="tile"><b>${totalOnTimePct === null ? "—" : totalOnTimePct + "%"}</b><span>on time</span></div>
  <div class="tile"><b>${reopens}</b><span>reopened</span></div>
</div>
<h2>Recap</h2>
${table(RECAP_HEADERS, recapRows(), "recap")}
${perMember.map((m) => `
<h2>${esc(m.name)}</h2>
<div class="sub">${esc(memberStatLine(m))}</div>
${m.rows.length ? table(MEMBER_TABLE_HEADERS, memberTableRows(m)) : ""}`).join("")}
</div></body></html>`;
    saveBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `app-completion-report-${stamp()}.html`);
  };

  return (
    <div
      onClick={onClose}
      className="app-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(30,34,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="app-modal" style={{ background: C.surface, borderRadius: 12, padding: 22, width: "100%", maxWidth: 640, fontFamily: sans, maxHeight: "85vh", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 2px", fontSize: 18, fontWeight: 800, color: C.ink }}>Completion stats</h2>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>
          Recorded automatically whenever a task is moved to Done, and kept even if
          the task is later edited, archived or deleted. Reports have a recap table and
          individual stats per member. Pick dates to report on a period: tasks assigned
          on or after the start date and marked complete on or before the end date.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, display: "block", marginBottom: 5 }}>Assigned from</label>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`, fontSize: 13, fontFamily: sans, color: C.ink, boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, display: "block", marginBottom: 5 }}>Completed by</label>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`, fontSize: 13, fontFamily: sans, color: C.ink, boxSizing: "border-box" }} />
          </div>
          {ranged && (
            <button onClick={() => { setFrom(""); setTo(""); }} style={{ background: "transparent", color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 7, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
              All time
            </button>
          )}
        </div>

        {rows === null && (
          <div style={{ fontFamily: mono, fontSize: 11, color: C.inkSoft, textAlign: "center", padding: "18px 0" }}>Loading…</div>
        )}

        {rows && (
          <div style={{ background: C.bg, borderRadius: 8, padding: "12px 14px", marginBottom: 14, fontSize: 13, color: C.ink }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.accent, marginBottom: 4 }}>{periodText}</div>
            {rows.length === 0 ? (
              ranged
                ? <>No completions in this period — widen the dates.</>
                : <>No completions recorded yet — data starts collecting once tasks are moved to Done.</>
            ) : (
              <><b>{standing.length}</b> completed task{standing.length === 1 ? "" : "s"} on record
              {totalOnTimePct !== null ? <> · {totalOnTimePct}% on time</> : null}
              {reopens > 0 ? <> · {reopens} reopened</> : null}.
              {" "}Download a report to see the full breakdown per member and per event.</>
            )}
          </div>
        )}

        {owner && allRows && allRows.length > 0 && (
          confirmReset ? (
            <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>
                Permanently delete all <b>{allRows.length}</b> completion record{allRows.length === 1 ? "" : "s"} and
                start fresh? This cannot be undone — download a report first if you want to keep the history.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={async () => {
                    setConfirmReset(false);
                    setBusy(true);
                    const { error } = await supabase.from("task_completions").delete().not("id", "is", null);
                    setBusy(false);
                    if (error) note("Reset failed — owner access needed", true);
                    else { setAllRows([]); note("Stats reset ✓"); }
                  }}
                  disabled={busy}
                  style={{ background: C.red, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: sans }}
                >
                  Yes, delete everything
                </button>
                <button onClick={() => setConfirmReset(false)} style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 7, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              disabled={busy}
              style={{ width: "100%", marginBottom: 12, background: "transparent", color: C.red, border: `1px solid ${C.red}55`, borderRadius: 8, padding: "9px 0", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: sans }}
            >
              ⚠ Reset all stats (owner)
            </button>
          )
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
            Close
          </button>
          <button
            onClick={downloadHtml}
            disabled={!rows || rows.length === 0}
            style={{ flex: 1, background: "transparent", color: C.accent, border: `1px solid ${C.accent}66`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: sans, opacity: rows && rows.length ? 1 : 0.5 }}
          >
            ⭳ HTML report
          </button>
          <button
            onClick={() => downloadExcel().catch(() => note("Excel export failed — try again", true))}
            disabled={!rows || rows.length === 0}
            style={{ flex: 1, background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: sans, opacity: rows && rows.length ? 1 : 0.5 }}
          >
            ⭳ Excel
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================================================================
// Completion dialog — asks for minutes spent + notes when finishing a task
// ==================================================================
function CompletionModal({ title, onDone, onCancel }) {
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Time taken is required; the confirm step guards against accidental drops
  const h = parseInt(hours || "0", 10), m = parseInt(minutes || "0", 10);
  const total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  const valid = (hours !== "" || minutes !== "") && h >= 0 && m >= 0 && total > 0;

  const next = () => valid && setConfirming(true);
  const finish = () =>
    onDone({
      minutes_spent: total,
      completion_notes: notes.trim() || null,
    });

  const input = {
    width: "100%", padding: "10px 11px", borderRadius: 8, border: `1px solid ${C.line}`,
    fontSize: 13.5, fontFamily: sans, color: C.ink, background: "#fff", boxSizing: "border-box",
  };
  const label = { fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, display: "block", marginBottom: 5, marginTop: 14 };

  return (
    <div
      onClick={onCancel}
      className="app-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(30,34,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 60 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="app-modal" style={{ background: C.surface, borderRadius: 12, padding: 22, width: "100%", maxWidth: 380, fontFamily: sans }}>
        {confirming ? (
          <>
            <h2 style={{ margin: "0 0 2px", fontSize: 18, fontWeight: 800, color: C.ink }}>Submit as complete?</h2>
            <p style={{ margin: "0 0 12px", fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>
              Are you sure you want to mark “{title}” as done? This is recorded in the stats and debriefs.
            </p>
            <div style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: C.ink, lineHeight: 1.6 }}>
              <div>Time taken: <b>{fmtMinutes(total)}</b></div>
              {notes.trim() && <div style={{ color: C.inkSoft, whiteSpace: "pre-wrap" }}>Notes: {notes.trim()}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setConfirming(false)}
                style={{ flex: 1, background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}
              >
                Back
              </button>
              <button
                onClick={finish}
                autoFocus
                style={{ flex: 2, background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: sans }}
              >
                Yes, submit
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ margin: "0 0 2px", fontSize: 18, fontWeight: 800, color: C.ink }}>Task complete 🎉</h2>
            <p style={{ margin: "0 0 2px", fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>
              “{title}” — how long did it take? Time feeds your hours in debriefs.
            </p>

            <label style={label}>Time taken</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                style={{ ...input, flex: 1 }}
                type="number" min="0" inputMode="numeric"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && next()}
                placeholder="0"
                aria-label="Hours"
                autoFocus
              />
              <span style={{ fontSize: 13, color: C.inkSoft }}>h</span>
              <input
                style={{ ...input, flex: 1 }}
                type="number" min="0" max="59" inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && next()}
                placeholder="45"
                aria-label="Minutes"
              />
              <span style={{ fontSize: 13, color: C.inkSoft }}>min</span>
            </div>

            <label style={label}>Notes (optional)</label>
            <textarea
              style={{ ...input, minHeight: 68, resize: "vertical", fontFamily: sans }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth recording — blockers, what's left, who helped…"
            />

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={onCancel}
                style={{ flex: 1, background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}
              >
                Cancel
              </button>
              <button
                onClick={next}
                disabled={!valid}
                title={valid ? "" : "Enter how long it took"}
                style={{ flex: 2, background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: valid ? "pointer" : "not-allowed", fontFamily: sans, opacity: valid ? 1 : 0.5 }}
              >
                Continue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ==================================================================
// Audit log page (admins only) — written by DB triggers, read-only here
// ==================================================================
function AuditPage({ members, owner, note, onBack }) {
  const [rows, setRows] = useState(null); // null = loading
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      note("Couldn't load the audit log — admin access needed", true);
      setRows([]);
    } else setRows(data);
  };
  useEffect(() => { load(); }, []);

  const clearLog = async () => {
    setConfirmClear(false);
    setBusy(true);
    const { error } = await supabase.from("audit_log").delete().not("id", "is", null);
    setBusy(false);
    if (error) note("Clear failed — owner access needed", true);
    else {
      note("Audit log cleared ✓");
      load(); // reload to show the "cleared the audit log" trace entry
    }
  };

  const fmt = (d) =>
    new Date(d).toLocaleString("en-AU", {
      day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });

  // Group entries by calendar day for readability
  const byDay = useMemo(() => {
    const groups = [];
    (rows || []).forEach((r) => {
      const day = new Date(r.created_at).toLocaleDateString("en-AU", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
      const g = groups.find((x) => x.day === day);
      if (g) g.items.push(r);
      else groups.push({ day, items: [r] });
    });
    return groups;
  }, [rows]);

  return (
    <div className="app-page" style={{ minHeight: "100vh", background: C.bg, fontFamily: sans, color: C.ink, padding: "24px 20px 48px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Page header */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Logo size={44} />
            <div>
              <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: 2, color: C.accent, textTransform: "uppercase", marginBottom: 2 }}>
                Team · Operations
              </div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>Audit log</h1>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {owner && rows && rows.length > 0 && !confirmClear && (
              <button
                onClick={() => setConfirmClear(true)}
                disabled={busy}
                style={{
                  background: "transparent", border: `1px solid ${C.red}55`, borderRadius: 8,
                  padding: "9px 16px", cursor: "pointer", fontFamily: sans, fontSize: 13,
                  fontWeight: 600, color: C.red,
                }}
              >
                ⚠ Clear log
              </button>
            )}
            <button
              onClick={onBack}
              style={{
                background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8,
                padding: "9px 16px", cursor: "pointer", fontFamily: sans, fontSize: 13,
                fontWeight: 600, color: C.ink,
              }}
            >
              ← Back to board
            </button>
          </div>
        </div>

        {confirmClear && (
          <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>
              Permanently delete all <b>{rows?.length}</b> audit entr{rows?.length === 1 ? "y" : "ies"}?
              This cannot be undone. A single "cleared the audit log" entry with your name will remain.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={clearLog} disabled={busy} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: sans }}>
                Yes, clear everything
              </button>
              <button onClick={() => setConfirmClear(false)} style={{ background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 7, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <p style={{ margin: "0 0 16px", fontSize: 13, color: C.inkSoft, lineHeight: 1.5 }}>
          Recorded automatically by the database — task and event changes, archive
          actions and stats resets, with who did them and when. Latest 300 entries.
          Only admins can see this page.
        </p>

        {rows === null && (
          <div style={{ fontFamily: mono, fontSize: 12, color: C.inkSoft, textAlign: "center", padding: "40px 0" }}>Loading…</div>
        )}
        {rows && rows.length === 0 && (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "28px 20px", textAlign: "center", fontFamily: mono, fontSize: 12, color: C.inkSoft }}>
            Nothing recorded yet — entries appear as the team works.
          </div>
        )}

        {byDay.map((g) => (
          <div key={g.day} style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: C.inkSoft, margin: "0 0 8px 2px" }}>
              {g.day}
            </div>
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "4px 16px" }}>
              {g.items.map((r) => {
                const m = memberForEmail(members, r.actor);
                return (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
                    {m ? <Avatar m={m} size={26} /> : (
                      <span style={{ width: 26, height: 26, borderRadius: "50%", background: C.line, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: C.inkSoft, flexShrink: 0 }}>?</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.45 }}>
                        <b>{memberNameForEmail(members, r.actor)}</b> {r.action}
                      </div>
                    </div>
                    <span style={{ fontFamily: mono, fontSize: 10.5, color: C.inkSoft, flexShrink: 0 }}>
                      {fmt(r.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================================================================
// Team manager (owners only) — members, logins, passwords, roles
// ==================================================================
function TeamModal({ members, roles, user, note, reloadRoles, onClose }) {
  const [openId, setOpenId] = useState(null); // member id with expanded controls
  const [busy, setBusy] = useState(false);
  const [authUsers, setAuthUsers] = useState(null); // [{email, last_sign_in_at}] or null
  const [edgeDown, setEdgeDown] = useState(false);

  // Add-member form
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmAdd, setConfirmAdd] = useState(false); // adding WITH a login needs confirming

  // Per-member edit form (populated when a row is expanded)
  const [f, setF] = useState({});
  const [pw, setPw] = useState("");
  const [confirmDemote, setConfirmDemote] = useState(null); // target role for self-demotion
  const [confirmPw, setConfirmPw] = useState(null); // 'reset' | 'create' pending confirmation

  const callEdge = async (action, payload) => {
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action, payload },
    });
    if (error) throw new Error(data?.error || error.message || "Request failed");
    if (data?.error) throw new Error(data.error);
    return data;
  };

  useEffect(() => {
    callEdge("list_users")
      .then((d) => setAuthUsers(d.users))
      .catch(() => { setAuthUsers([]); setEdgeDown(true); });
  }, []);

  const hasLogin = (email) =>
    !!email && (authUsers || []).some((u) => u.email === email.toLowerCase());
  const hasMfa = (email) =>
    !!email && (authUsers || []).some((u) => u.email === email.toLowerCase() && u.mfa);

  const removeMfa = (m) =>
    run(async () => {
      await callEdge("remove_mfa", { email: m.email });
      setAuthUsers((us) => (us || []).map((u) => (u.email === m.email ? { ...u, mfa: false } : u)));
    }, "2FA removed ✓");

  const slugFor = (name) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "member";
    let id = base, n = 2;
    while (members.some((m) => m.id === id)) id = base + n++;
    return id;
  };
  const initialsFor = (name) => {
    const parts = name.trim().split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2))
      .replace(/^./, (c) => c.toUpperCase());
  };
  const nextColor = () =>
    MEMBER_COLORS.find((c) => !members.some((m) => m.color === c)) ||
    MEMBER_COLORS[members.length % MEMBER_COLORS.length];

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) note(okMsg);
    } catch (e) {
      note(e.message || "Something went wrong", true);
    }
    setBusy(false);
  };

  const addMember = () =>
    run(async () => {
      const name = newName.trim();
      if (!name) throw new Error("Name is required");
      const email = newEmail.trim().toLowerCase() || null;
      if (email && newPw && newPw.length < 8) throw new Error("Password must be 8+ characters");
      const row = {
        id: slugFor(name), name, initials: initialsFor(name),
        color: nextColor(), email, active: true,
      };
      const { error } = await supabase.from("members").insert(row);
      if (error) throw new Error(error.message);
      if (email && newPw) await callEdge("create_user", { email, password: newPw });
      setNewName(""); setNewEmail(""); setNewPw(""); setConfirmAdd(false);
    }, "Member added ✓");

  const openRow = (m) => {
    setOpenId(openId === m.id ? null : m.id);
    setF({
      name: m.name, initials: m.initials, color: m.color, email: m.email || "",
      team: m.team || "", photo_url: m.photo_url || "",
      prior_deficit_hours: m.prior_deficit_hours ?? 0,
      email_reminders: m.email_reminders !== false,
    });
    setPw("");
    setConfirmDemote(null);
    setConfirmPw(null);
  };

  const saveDetails = (m) =>
    run(async () => {
      const email = f.email.trim().toLowerCase() || null;
      const photo = f.photo_url.trim();
      if (photo && !/^https:\/\//i.test(photo)) throw new Error("Photo link must start with https://");
      const { error } = await supabase.from("members")
        .update({
          name: f.name.trim(), initials: f.initials.trim(), color: f.color, email,
          team: f.team.trim() || null,
          photo_url: photo || null,
          prior_deficit_hours: Number(f.prior_deficit_hours) || 0,
          email_reminders: f.email_reminders,
        })
        .eq("id", m.id);
      if (error) throw new Error(error.message);
      // If they already had a login and the email changed, move the login too
      if (m.email && email && m.email !== email && hasLogin(m.email)) {
        await callEdge("update_email", { email: m.email, new_email: email });
        setAuthUsers((us) => us.map((u) => (u.email === m.email ? { ...u, email } : u)));
      }
    }, "Saved ✓");

  const createLogin = (m) =>
    run(async () => {
      const email = (f.email || m.email || "").trim().toLowerCase();
      if (!email) throw new Error("Set an email first");
      if (pw.length < 8) throw new Error("Password must be 8+ characters");
      await callEdge("create_user", { email, password: pw });
      if (email !== m.email) {
        await supabase.from("members").update({ email }).eq("id", m.id);
      }
      setAuthUsers((us) => [...(us || []), { email }]);
      setPw("");
    }, "Login created ✓");

  const resetPassword = (m) =>
    run(async () => {
      if (pw.length < 8) throw new Error("Password must be 8+ characters");
      await callEdge("reset_password", { email: m.email, password: pw });
      setPw("");
    }, "Password reset ✓");

  const sendResetLink = (m) =>
    run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(m.email, {
        redirectTo: window.location.origin,
      });
      if (error) throw new Error(error.message);
    }, "Reset link sent ✓");

  const setRole = (m, role) =>
    run(async () => {
      if (!m.email) throw new Error("Member needs an email first");
      if (role === "none") {
        const { error } = await supabase.from("roles").delete().eq("email", m.email);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("roles")
          .upsert({ email: m.email, role, updated_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
      }
      await reloadRoles();
    }, "Role updated ✓");

  const toggleActive = (m) =>
    run(async () => {
      const { error } = await supabase.from("members")
        .update({ active: !m.active }).eq("id", m.id);
      if (error) throw new Error(error.message);
    }, m.active ? "Member deactivated" : "Member reactivated ✓");

  const input = {
    width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`,
    fontSize: 13, fontFamily: sans, color: C.ink, background: "#fff", boxSizing: "border-box",
  };
  const label = { fontFamily: mono, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: C.inkSoft, display: "block", marginBottom: 4, marginTop: 10 };
  const smallBtn = (color, solid) => ({
    background: solid ? color : "transparent", color: solid ? "#fff" : color,
    border: solid ? "none" : `1px solid ${color}55`, borderRadius: 7,
    padding: "7px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans,
  });

  return (
    <div
      onClick={onClose}
      className="app-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(30,34,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="app-modal" style={{ background: C.surface, borderRadius: 12, padding: 22, width: "100%", maxWidth: 560, fontFamily: sans, maxHeight: "88vh", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 2px", fontSize: 18, fontWeight: 800, color: C.ink }}>Team (owner)</h2>
        <p style={{ margin: "0 0 6px", fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>
          Manage members, logins, passwords and roles. Deactivating hides someone from
          the board but keeps their history. New passwords are temporary — ask people
          to change them from their account panel after first sign-in.
        </p>
        {edgeDown && (
          <div style={{ margin: "0 0 10px", background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: C.ink }}>
            Couldn't reach the account service — member details and roles still work,
            but creating logins / resetting passwords won't until it's back.
          </div>
        )}

        {members.map((m) => {
          const role = roleForEmail(roles, m.email);
          const login = hasLogin(m.email);
          const mfa = hasMfa(m.email);
          // Peer rules: owners may reset each other's passwords (recovery),
          // but another owner's role, email and active status are off-limits
          // (also enforced in SQL + the edge function).
          const isSelf = m.email === (user.email || "").toLowerCase();
          const lockedPeer = role === "owner" && !isSelf;
          return (
            <div key={m.id} style={{ borderBottom: `1px solid ${C.line}`, padding: "9px 0", opacity: m.active ? 1 : 0.55 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar m={m} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>
                    {m.name}
                    {!m.active && <span style={{ fontFamily: mono, fontSize: 9, color: C.inkSoft, marginLeft: 6, textTransform: "uppercase" }}>inactive</span>}
                    {role && (
                      <span style={{ fontFamily: mono, fontSize: 9, color: role === "owner" ? "#fff" : C.accent, background: role === "owner" ? C.accent : C.accentSoft, padding: "1px 6px", borderRadius: 3, marginLeft: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        {roleLabel(role)}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.team ? `${m.team} · ` : ""}{m.email || "no email"}{m.email ? (login ? " · has login" : " · no login yet") : ""}{mfa ? " · 2FA on" : ""}
                  </div>
                </div>
                <button onClick={() => openRow(m)} style={smallBtn(C.accent, openId === m.id)}>
                  {openId === m.id ? "Close" : "Manage"}
                </button>
              </div>

              {openId === m.id && (
                <div style={{ background: C.bg, borderRadius: 8, padding: "4px 12px 12px", marginTop: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                    <div>
                      <label style={label}>Name</label>
                      <input style={input} value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div>
                      <label style={label}>Initials</label>
                      <input style={input} maxLength={2} value={f.initials} onChange={(e) => setF((p) => ({ ...p, initials: e.target.value }))} />
                    </div>
                  </div>
                  <label style={label}>Colour</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {MEMBER_COLORS.map((c) => (
                      <button key={c} onClick={() => setF((p) => ({ ...p, color: c }))}
                        style={{ width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer", border: f.color === c ? `3px solid ${C.ink}` : "3px solid transparent", padding: 0 }} />
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={label}>Team</label>
                      <input style={input} list="app-teams" value={f.team} onChange={(e) => setF((p) => ({ ...p, team: e.target.value }))} placeholder="e.g. Events" />
                      <datalist id="app-teams">
                        {[...new Set(members.map((x) => x.team).filter(Boolean))].map((t) => <option key={t} value={t} />)}
                      </datalist>
                    </div>
                    <div>
                      <label style={label}>Deficit before app (hours)</label>
                      <input style={input} type="number" step="0.5" value={f.prior_deficit_hours} onChange={(e) => setF((p) => ({ ...p, prior_deficit_hours: e.target.value }))} />
                    </div>
                  </div>
                  <label style={label}>Photo link (optional)</label>
                  <input style={input} value={f.photo_url} onChange={(e) => setF((p) => ({ ...p, photo_url: e.target.value }))} placeholder="https://… (blank shows the app logo)" />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, color: C.ink, cursor: "pointer" }}>
                    <input type="checkbox" checked={f.email_reminders} onChange={(e) => setF((p) => ({ ...p, email_reminders: e.target.checked }))} style={{ accentColor: C.accent }} />
                    Send this member email reminders
                  </label>
                  <label style={label}>Login email</label>
                  <input style={{ ...input, opacity: lockedPeer ? 0.5 : 1 }} type="email" value={f.email} disabled={lockedPeer} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} placeholder="name@example.com" />
                  <div style={{ marginTop: 10 }}>
                    <button onClick={() => saveDetails(m)} disabled={busy} style={smallBtn(C.accent, true)}>Save details</button>
                  </div>

                  <label style={label}>{login ? "Reset password (temporary)" : "Create login — temporary password"}</label>
                  {confirmPw ? (
                    <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>
                        {confirmPw === "reset" ? (
                          <>Reset <b>{m.name}</b>'s password? Their current password stops
                          working immediately — pass them the new temporary one privately.</>
                        ) : confirmPw === "link" ? (
                          <>Email a password-reset link to <b>{(m.email || "").toLowerCase()}</b>?
                          {" "}{m.name} sets their own new password — nobody handles it for them.</>
                        ) : confirmPw === "mfa" ? (
                          <>Remove <b>{m.name}</b>'s two-factor authentication? They'll sign in
                          with just their password until they re-enable it. Use this when
                          someone loses their authenticator device.</>
                        ) : (
                          <>Create a login for <b>{m.name}</b> ({(f.email || m.email || "").toLowerCase()})
                          with this temporary password?</>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => {
                            const a = confirmPw;
                            setConfirmPw(null);
                            if (a === "reset") resetPassword(m);
                            else if (a === "link") sendResetLink(m);
                            else if (a === "mfa") removeMfa(m);
                            else createLogin(m);
                          }}
                          disabled={busy}
                          style={smallBtn(C.red, true)}
                        >
                          {confirmPw === "reset" ? "Yes, reset password" : confirmPw === "link" ? "Yes, send link" : confirmPw === "mfa" ? "Yes, remove 2FA" : "Yes, create login"}
                        </button>
                        <button onClick={() => setConfirmPw(null)} style={smallBtn(C.inkSoft, false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input style={{ ...input, flex: 1 }} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8+ characters" />
                        <button
                          onClick={() => {
                            if (pw.length < 8) return note("Password must be 8+ characters", true);
                            setConfirmPw(login ? "reset" : "create");
                          }}
                          disabled={busy || edgeDown}
                          style={{ ...smallBtn(C.ink, true), opacity: edgeDown ? 0.5 : 1 }}
                        >
                          {login ? "Reset" : "Create login"}
                        </button>
                      </div>
                      {login && (
                        <button
                          onClick={() => setConfirmPw("link")}
                          disabled={busy}
                          style={{ marginTop: 8, background: "transparent", color: C.accent, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans, textDecoration: "underline", padding: 0 }}
                        >
                          …or email {m.name} a reset link instead (they pick their own password)
                        </button>
                      )}
                      {mfa && (
                        <button
                          onClick={() => setConfirmPw("mfa")}
                          disabled={busy || edgeDown}
                          style={{ display: "block", marginTop: 6, background: "transparent", color: C.red, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: sans, textDecoration: "underline", padding: 0 }}
                        >
                          Remove {m.name}'s 2FA (lost authenticator)
                        </button>
                      )}
                    </>
                  )}

                  {lockedPeer ? (
                    <div style={{ marginTop: 12, background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: C.ink }}>
                      Owners can't change another owner's role, email or status — only
                      {" "}{m.name} can (password resets, name and colour are allowed).
                    </div>
                  ) : (
                    <>
                      <label style={label}>Role</label>
                      {confirmDemote ? (
                        <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>
                            Demote <b>yourself</b> from owner to {roleLabel(confirmDemote === "none" ? null : confirmDemote).toLowerCase()}?
                            You'll immediately lose this Team panel, and only another owner
                            can make you an owner again.
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              onClick={() => { const r = confirmDemote; setConfirmDemote(null); setRole(m, r); }}
                              disabled={busy}
                              style={smallBtn(C.red, true)}
                            >
                              Yes, demote me
                            </button>
                            <button onClick={() => setConfirmDemote(null)} style={smallBtn(C.inkSoft, false)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6 }}>
                          {[["none", "Leader"], ["team_admin", "Team admin"], ["admin", "Exec"], ["owner", "Owner"]].map(([value, text]) => (
                            <button key={value}
                              onClick={() => {
                                if (isSelf && role === "owner" && value !== "owner") setConfirmDemote(value);
                                else setRole(m, value);
                              }}
                              disabled={busy || (role || "none") === value}
                              style={{
                                flex: 1, padding: "7px 0", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: sans,
                                background: (role || "none") === value ? C.ink : "#fff",
                                color: (role || "none") === value ? "#fff" : C.inkSoft,
                                border: `1px solid ${(role || "none") === value ? C.ink : C.line}`,
                              }}
                            >
                              {text}
                            </button>
                          ))}
                        </div>
                      )}

                      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                        <button onClick={() => toggleActive(m)} disabled={busy || isSelf}
                          title={isSelf ? "You can't deactivate yourself" : ""}
                          style={smallBtn(m.active ? C.red : C.accent, false)}>
                          {m.active ? "Deactivate member" : "Reactivate member"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div style={{ background: C.accentSoft, borderRadius: 8, padding: "4px 12px 12px", marginTop: 14 }}>
          <label style={label}>Add a new member</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input style={input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" />
            <input style={input} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email (optional)" />
          </div>
          {confirmAdd ? (
            <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 12px", marginTop: 8 }}>
              <div style={{ fontSize: 13, color: C.ink, marginBottom: 8 }}>
                Add <b>{newName.trim()}</b> AND create a login for
                {" "}{newEmail.trim().toLowerCase()} with this temporary password?
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={addMember} disabled={busy} style={smallBtn(C.red, true)}>
                  Yes, add with login
                </button>
                <button onClick={() => setConfirmAdd(false)} style={smallBtn(C.inkSoft, false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input style={{ ...input, flex: 1 }} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Temp password (optional, creates login)" />
              <button
                onClick={() => {
                  if (newEmail.trim() && newPw) {
                    if (newPw.length < 8) return note("Password must be 8+ characters", true);
                    setConfirmAdd(true);
                  } else addMember();
                }}
                disabled={busy || !newName.trim()}
                style={{ ...smallBtn(C.accent, true), opacity: newName.trim() ? 1 : 0.5 }}
              >
                + Add
              </button>
            </div>
          )}
        </div>

        <button onClick={onClose} style={{ width: "100%", marginTop: 16, background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
          Close
        </button>
      </div>
    </div>
  );
}
