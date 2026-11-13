"use client";

// Extra commission (+) and extra deduction (−) for one user, on the Users form (client, 13 Nov 2026):
// just a name, an amount and the dates it is active. A deduction's amount is ₹ or % of the fix salary.
import { useState, type CSSProperties, type ReactNode } from "react";
import { C } from "@/lib/colors";
import { istToday } from "@/lib/period";
import { inr } from "@/lib/money";
import Tag from "@/components/ui/Tag";
import type { ExtraCommission, ExtraDeduction } from "@callflow/shared-types";

type Item = ExtraCommission & { type?: ExtraDeduction["type"] };
const fmtD = (s: string) => new Date(`${s}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const plusDays = (n: number) => istToday(new Date(Date.now() + n * 86_400_000));

/** Active today (IST), so it shows on the user's dashboard. */
export const isActive = (x: Item) => { const t = istToday(); return x.from <= t && t <= x.to; };
/** "₹500" or "10% of salary". */
export const amountText = (x: Item) => (x.type === "pct" ? `${x.amount}% of salary` : inr(x.amount));
/** The ₹ a deduction takes off a fix salary. */
export const deductionValue = (x: ExtraDeduction, salary: number) => Math.round(x.type === "pct" ? (salary * x.amount) / 100 : x.amount);
/** "₹500 · 13 Nov – 19 Nov 2026". */
export const extraText = (x: Item) => `${amountText(x)} · ${fmtD(x.from)} – ${fmtD(x.to)}`;

/** Same checks as the server (extraSchema / deductionSchema), so the form says what is wrong before Save. */
export function extraProblem(x: Item): string | null {
  if (!x.name.trim()) return "Give it a name";
  if (!(x.amount > 0)) return "Enter the amount";
  if (x.type === "pct" && x.amount > 100) return "A percentage can't be more than 100";
  if (!x.from || !x.to) return "Pick the start and end dates";
  if (x.from > x.to) return "The end date is before the start date";
  return null;
}

const status = (x: Item) => {
  const today = istToday();
  return x.to < today ? { label: "Ended", color: C.muted, bg: C.bgDeep }
    : x.from > today ? { label: "Scheduled", color: C.blue, bg: C.blueLight }
    : { label: "Active", color: C.green, bg: C.greenLight };
};

export default function ExtraCommissions<T extends Item>({ value, onChange, input, label, deduction = false }: {
  value: T[]; onChange: (v: T[]) => void; input: CSSProperties; label: CSSProperties; deduction?: boolean;
}) {
  // null = closed, -1 = adding a new one, n = editing the n-th
  const [open, setOpen] = useState<number | null>(null);
  const word = deduction ? "extra deduction" : "extra commission";
  const tone = deduction ? { c: C.red, bg: C.redLight, bdr: C.red } : { c: C.orange, bg: C.orangeLight, bdr: C.orangeBdr };
  const builder = (initial: T | undefined, done: (y: T) => void) => (
    <Builder<T> initial={initial} deduction={deduction} input={input} label={label} tone={tone.c} onCancel={() => setOpen(null)}
      onDone={(y) => { done(y); setOpen(null); }} />
  );
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {value.length === 0 && open === null && <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>No {word} for this user.</p>}
      {value.map((x, i) => open === i
        ? <div key={i}>{builder(x, (y) => onChange(value.map((v, j) => (j === i ? y : v))))}</div>
        : (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <b style={{ fontSize: 14, color: C.text }}>{x.name}</b>
                <Tag label={status(x).label} color={status(x).color} bg={status(x).bg} style={{ fontSize: 11 }} />
              </div>
              <div style={{ fontSize: 13, color: C.textSub, marginTop: 2 }}>{deduction ? "− " : "+ "}{extraText(x)}</div>
            </div>
            <button type="button" onClick={() => setOpen(i)} style={linkBtn(C.orange)}>Edit</button>
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove ${x.name}`} style={linkBtn(C.red)}>Remove</button>
          </div>
        ))}
      {open === -1
        ? builder(undefined, (y) => onChange([...value, y]))
        : open === null && value.length < 20 && (
          <button type="button" onClick={() => setOpen(-1)}
            style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 10, cursor: "pointer",
              border: `1px dashed ${tone.bdr}`, background: tone.bg, color: tone.c, fontSize: 13.5, fontWeight: 700 }}>
            <span aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>{deduction ? "−" : "+"}</span> Add {word}</button>
        )}
    </div>
  );
}

/** Module level on purpose: a component defined inside Builder would remount its input on every keystroke. */
function F({ text, children, w, label }: { text: string; children: ReactNode; w?: number; label: CSSProperties }) {
  return <label style={{ display: "block", minWidth: 0, ...(w ? { flex: `0 0 ${w}px` } : { flex: "1 1 200px" }) }}><span style={label}>{text}</span>{children}</label>;
}

const linkBtn = (color: string): CSSProperties => ({ border: "none", background: "none", color, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 4 });

function Builder<T extends Item>({ initial, deduction, onDone, onCancel, input, label, tone }: {
  initial?: T; deduction: boolean; onDone: (x: T) => void; onCancel: () => void; input: CSSProperties; label: CSSProperties; tone: string;
}) {
  const [x, setX] = useState<Item>(initial ?? { name: "", amount: 0, from: plusDays(0), to: plusDays(29), ...(deduction ? { type: "fix" as const } : {}) });
  const [err, setErr] = useState("");
  const set = (p: Partial<Item>) => { setErr(""); setX((v) => ({ ...v, ...p })); };
  const done = () => {
    const y = { ...x, name: x.name.trim() };
    const problem = extraProblem(y);
    if (problem) return setErr(problem);
    onDone(y as T);
  };
  return (
    <div role="group" aria-label={deduction ? "Extra deduction form" : "Extra commission form"}
      style={{ display: "grid", gap: 12, padding: "14px 16px", background: C.card, border: `1px solid ${tone}`, borderRadius: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <F label={label} text={deduction ? "Name of deduction" : "Name of extra commission"}>
          <input autoFocus value={x.name} maxLength={60} placeholder={deduction ? "e.g. Late coming" : "e.g. Diwali bonus"} onChange={(e) => set({ name: e.target.value })} style={input} /></F>
        {deduction && <F label={label} text="Deduct as" w={150}>
          <select value={x.type} onChange={(e) => set({ type: e.target.value as ExtraDeduction["type"] })} style={input}>
            <option value="fix">Fixed amount (₹)</option><option value="pct">% of salary</option>
          </select></F>}
        <F label={label} text={x.type === "pct" ? "Percent" : "Amount (₹)"} w={130}>
          <input type="number" min={0} max={x.type === "pct" ? 100 : undefined} value={x.amount || ""} onChange={(e) => set({ amount: Number(e.target.value) })} style={input} /></F>
        <F label={label} text="Active from" w={160}><input type="date" value={x.from} max={x.to || undefined} onChange={(e) => set({ from: e.target.value })} style={input} /></F>
        <F label={label} text="Active to" w={160}><input type="date" value={x.to} min={x.from || undefined} onChange={(e) => set({ to: e.target.value })} style={input} /></F>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
        {err && <span role="alert" style={{ color: C.red, fontSize: 13, marginRight: "auto" }}>{err}</span>}
        <span style={{ fontSize: 12, color: C.muted, marginRight: err ? 0 : "auto" }}>Saved with the rest of the form when you press Save.</span>
        <button type="button" onClick={onCancel} style={{ ...linkBtn(C.textSub), padding: "8px 12px" }}>Cancel</button>
        <button type="button" onClick={done} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: tone, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
          {initial ? "Update" : "Add"}</button>
      </div>
    </div>
  );
}
