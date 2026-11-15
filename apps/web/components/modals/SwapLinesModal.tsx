"use client";

// Swap the agents of two lines in one step (client, 15 Nov 2026). With one person per line you can't do it by picking
// from the lists, because each person would have to be freed first. Past calls stay with whoever had the line then.
import { useState } from "react";
import { mutate } from "swr";
import { C } from "@/lib/colors";
import { api } from "@/lib/api";
import type { Line } from "@callflow/shared-types";

const field = { width: "100%", padding: "10px 12px", boxSizing: "border-box", background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, color: C.text, outline: "none" } as const;
const label = { display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 } as const;

export default function SwapLinesModal({ lines, onClose }: { lines: Line[]; onClose: () => void }) {
  const withAgent = lines.filter((l) => l.employee_id);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [intercoms, setIntercoms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const la = withAgent.find((l) => l.id === a), lb = withAgent.find((l) => l.id === b);

  async function swap() {
    if (!la || !lb) return setError("Pick two lines.");
    setSaving(true);
    setError("");
    try {
      await api.post("/lines/swap", { a, b, with_intercoms: intercoms });
      await Promise.all([mutate("/lines"), mutate("/intercoms")]);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const pick = (value: string, set: (v: string) => void, other: string, name: string) => (
    <div style={{ marginBottom: 14 }}>
      <label style={label}>{name}</label>
      <select value={value} onChange={(e) => set(e.target.value)} style={field} aria-label={name}>
        <option value="">— Pick a line —</option>
        {withAgent.filter((l) => l.id !== other).map((l) => <option key={l.id} value={l.id}>{l.line_number} · {l.employee_name}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.18)", zIndex: 200 }} />
      <div role="dialog" aria-label="Swap agents" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 400, maxWidth: "calc(100vw - 32px)",
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: "28px 32px", boxShadow: C.shadowMd, zIndex: 201 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800, color: C.text }}>Swap agents</h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: C.muted }}>Two lines trade their agents. Calls already recorded stay with whoever had the line then.</p>
        {pick(a, setA, b, "First line")}
        {pick(b, setB, a, "Second line")}
        {la && lb && (
          <p style={{ margin: "0 0 14px", padding: "10px 12px", background: C.bgDeep, borderRadius: 10, fontSize: 13, color: C.text }}>
            Line {la.line_number} → <b>{lb.employee_name}</b><br />Line {lb.line_number} → <b>{la.employee_name}</b>
          </p>
        )}
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 18, fontSize: 13, color: C.textSub, cursor: "pointer" }}>
          <input type="checkbox" checked={intercoms} onChange={(e) => setIntercoms(e.target.checked)} style={{ marginTop: 2, accentColor: C.orange }} />
          <span>Move the intercoms too, so each calling number goes with its person</span>
        </label>
        {error && <p role="alert" style={{ margin: "0 0 12px", fontSize: 13, color: C.red }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 20px", border: `1px solid ${C.border}`, borderRadius: 10, background: C.bgDeep, color: C.textSub, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={swap} disabled={saving || !la || !lb} style={{ padding: "9px 20px", border: "none", borderRadius: 10, background: saving || !la || !lb ? C.dim : C.orange, color: "#fff", fontWeight: 700, fontSize: 13, cursor: saving || !la || !lb ? "not-allowed" : "pointer" }}>
            {saving ? "Swapping…" : "Swap"}</button>
        </div>
      </div>
    </>
  );
}
