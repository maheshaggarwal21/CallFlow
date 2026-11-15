"use client";

// Working days (Super Admin; daily salary, 15 Nov 2026): the weekly working days, the holidays, and the month from
// which daily pay starts. One panel for everyone. Saving refreshes the Employee Tracker.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { C } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import { istToday } from "@/lib/period";
import { S } from "@/components/salary/kit";

type Settings = { weekdays: number[]; daily_pay_from: string | null; holidays: { day: string; name: string }[]; month: string; working_days: number; daily: boolean };
const NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthName = (ym: string) => new Date(`${ym}-01T00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const dayName = (d: string) => new Date(`${d}T00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** This month, 3 before and 6 after, as YYYY-MM. */
function months(): string[] {
  const [y, m] = istToday().split("-").map(Number);
  return Array.from({ length: 10 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - 3 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default function WorkingDays({ month, onClose, onChanged }: { month: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, mutate } = useSWR<Settings>(`/pay/settings?month=${month}`, fetcher);
  const [weekdays, setWeekdays] = useState<number[] | null>(null);
  const [from, setFrom] = useState<string | null | undefined>(undefined);
  const [hDay, setHDay] = useState("");
  const [hName, setHName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data && weekdays === null) { setWeekdays(data.weekdays); setFrom(data.daily_pay_from); } }, [data, weekdays]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr(""); setSaved(false);
    try { await f(); await mutate(); onChanged(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };
  const save = () => run(() => api.put("/pay/settings", { weekdays, daily_pay_from: from ?? null })).then((ok) => ok && setSaved(true));
  const addHoliday = () => {
    if (!hDay) return setErr("Pick the holiday's date");
    if (!hName.trim()) return setErr("Give the holiday a name");
    run(() => api.post("/pay/holidays", { day: hDay, name: hName.trim() })).then((ok) => { if (ok) { setHDay(""); setHName(""); } });
  };
  const toggle = (n: number) => setWeekdays((w) => (w ?? []).includes(n) ? (w ?? []).filter((x) => x !== n) : [...(w ?? []), n].sort());
  const dirty = !!data && weekdays !== null && (JSON.stringify(weekdays) !== JSON.stringify(data.weekdays) || (from ?? null) !== data.daily_pay_from);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(43,33,24,0.35)", zIndex: 200 }} />
      <div role="dialog" aria-label="Working days" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 201,
        width: "min(560px, calc(100vw - 32px))", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: "24px 28px", boxShadow: "0 24px 60px -20px rgba(43,33,24,0.35)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: C.text }}>Working days</h3>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: C.muted }}>For everyone. A day that isn&apos;t a working day, or is a holiday, isn&apos;t counted at all: no salary and no targets.</p>
        {error && <p role="alert" style={{ color: C.red, fontSize: 13 }}>{(error as Error).message}</p>}
        {!data || weekdays === null ? <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p> : (
          <div style={{ display: "grid", gap: 18 }}>
            <div>
              <div style={S.label}>Weekly working days</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <label key={n} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                    border: `1px solid ${weekdays.includes(n) ? C.greenBdr : C.border}`, background: weekdays.includes(n) ? C.greenLight : C.card, color: weekdays.includes(n) ? C.green : C.textSub }}>
                    <input type="checkbox" checked={weekdays.includes(n)} onChange={() => toggle(n)} aria-label={NAMES[n]} style={{ accentColor: C.green }} />{NAMES[n]}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div style={S.label}>Daily pay starts from</div>
              <select value={from ?? ""} onChange={(e) => setFrom(e.target.value || null)} aria-label="Daily pay starts from" style={{ ...S.input, marginTop: 8, width: 260, background: C.card, fontSize: 14 }}>
                <option value="">Off (full monthly salary)</option>
                {months().map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: C.muted }}>Months before it keep the full monthly salary.</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button type="button" onClick={save} disabled={busy || !dirty} style={{ ...S.btnPrimary, opacity: busy || !dirty ? 0.55 : 1 }}>{busy ? "Saving…" : "Save"}</button>
              {saved && <span role="status" style={{ color: C.green, fontSize: 13, fontWeight: 700 }}>Saved ✓</span>}
              <span style={{ marginLeft: "auto", fontSize: 13, color: C.textSub }}>{monthName(data.month)}: <b style={{ color: C.text }}>{data.working_days} working days</b>{data.daily ? " · daily pay on" : ""}</span>
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
              <div style={S.label}>Holidays</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <input type="date" value={hDay} onChange={(e) => setHDay(e.target.value)} aria-label="Holiday date" style={{ ...S.input, width: 170, background: C.card }} />
                <input value={hName} maxLength={60} onChange={(e) => setHName(e.target.value)} placeholder="Name, e.g. Diwali" aria-label="Holiday name"
                  onKeyDown={(e) => e.key === "Enter" && addHoliday()} style={{ ...S.input, flex: "1 1 180px", background: C.card }} />
                <button type="button" onClick={addHoliday} disabled={busy} style={S.btn}>+ Add holiday</button>
              </div>
              <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                {data.holidays.length === 0 && <p style={{ margin: 0, fontSize: 13, color: C.muted }}>No holidays yet.</p>}
                {data.holidays.map((h) => (
                  <div key={h.day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13.5 }}>
                    <b style={{ color: C.text, minWidth: 150 }}>{dayName(h.day)}</b><span style={{ color: C.textSub, flex: 1 }}>{h.name}</span>
                    <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/pay/holidays/${h.day}`))} aria-label={`Remove holiday ${h.day}`}
                      style={{ border: "none", background: "none", color: C.red, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
            {err && <p role="alert" style={{ margin: 0, color: C.red, fontSize: 13 }}>{err}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" onClick={onClose} style={S.btn}>Close</button></div>
          </div>
        )}
      </div>
    </>
  );
}
