import { useState } from "react";
import { PERSONAS, personaEmail } from "./seed.js";
import { currentPersonaEmail, switchPersona, resetDemo } from "./mockSupabase.js";

// Floating strip shown only in demo mode: says the data is fictional, lets a
// visitor switch role to see how permissions change the app, and resets data.
export default function DemoBar() {
  const [open, setOpen] = useState(true);
  const current = PERSONAS.find((p) => personaEmail(p.id) === currentPersonaEmail())?.id || "";
  const box = {
    position: "fixed", left: 12, bottom: 12, zIndex: 1000,
    background: "#1E2230", color: "#fff", borderRadius: 10,
    boxShadow: "0 6px 24px rgba(0,0,0,.25)", fontFamily: "'Avenir Next','Segoe UI',system-ui,sans-serif",
    fontSize: 12.5, maxWidth: "calc(100vw - 24px)",
  };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...box, border: 0, padding: "7px 12px", cursor: "pointer", fontWeight: 700 }}>
        Demo ▴
      </button>
    );
  }
  return (
    <div style={{ ...box, padding: "10px 12px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span style={{ background: "#4C5FD5", borderRadius: 6, padding: "2px 7px", fontWeight: 800, letterSpacing: 0.5 }}>DEMO</span>
      <span style={{ opacity: 0.85 }}>Sample data · nothing is saved or sent</span>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ opacity: 0.85 }}>View as</span>
        <select
          value={current}
          onChange={(e) => switchPersona(e.target.value)}
          style={{ background: "#2E3446", color: "#fff", border: "1px solid #4A5168", borderRadius: 6, padding: "3px 6px", fontSize: 12.5 }}
        >
          {!current && <option value="">Choose…</option>}
          {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <button onClick={resetDemo} style={{ background: "transparent", color: "#fff", border: "1px solid #4A5168", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 12 }}>
        Reset data
      </button>
      <button onClick={() => setOpen(false)} aria-label="Hide demo bar" style={{ background: "transparent", color: "#fff", border: 0, cursor: "pointer", fontSize: 14, padding: "0 2px" }}>
        ×
      </button>
    </div>
  );
}
