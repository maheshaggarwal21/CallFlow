"use client";

// One person's month, day by day (daily salary, 15 Nov 2026; docs/salary-commission/EMPLOYEE-PAYMENT-FLOW.md).
// Shown in the Employee Tracker (Super Admin, with "Count as full") and on the rep's own dashboard (read-only).
// Every number comes from GET /pay/days — the same calculation as the tracker row and the dashboard's Pay card —
// and the totals here are the server's totals, never re-added in the browser.
import { useState } from "react";
import useSWR from "swr";
import { C } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import { inr } from "@/lib/money";

type Part = { key: "call" | "trial" | "regular"; done: number; target: number; quarters: 0 | 2 | 3 | 4 };
type Day = {
  day: string; weekday: number; kind: "working" | "off" | "holiday" | "future" | "away"; holiday: string | null;
  done: { call_secs: number; trial: number; regular: number } | null; parts: Part[]; noTargets: boolean; countAsFull: boolean;
  num: number; den: number; paise: number;
};
export type DaysData = {
  mode: "monthly" | "daily"; month: string; name: string; error: string | null; today: string;
  base: number; commission: number; total: number; working_days: number | null; days_so_far: number | null;
  trial: { count: number; commission: number }; regular: { count: number; commission: number };
  extras: { name: string; amount: number }[]; deductions: { name: string; amount: number }[];
  days: Day[] | null;
};

const WD = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// exact to the second, the same as the targets box on the dashboard
const hm = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
};
const STEP: Record<number, string> = { 0: "under 50 %", 2: "50 %+", 4: "met" };
const pct = (num: number, den: number) => `${Math.round((num / den) * 1000) / 10}%`;

/** `employeeId` empty = the signed-in person's own days. */
export default function DaysView({ employeeId, month, canOverride = false, onChanged }: {
  employeeId?: string; month: string; canOverride?: boolean; onChanged?: () => void;
}) {
  const key = `/pay/days?month=${month}${employeeId ? `&employee_id=${employeeId}` : ""}`;
  const { data, error, mutate, isLoading } = useSWR<DaysData>(key, fetcher);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const setFull = async (day: string, full: boolean) => {
    if (!employeeId) return;
    setBusy(day); setErr("");
    try { await api.put("/pay/overrides", { employee_id: employeeId, day, full }); await mutate(); onChanged?.(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(""); }
  };

  if (error) return <p role="alert" style={{ margin: 0, color: C.red, fontSize: 14 }}>{(error as Error).message}</p>;
  if (isLoading || !data) return <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Loading…</p>;
  if (data.mode !== "daily" || !data.days) {
    return <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Daily pay is not on for this month: the full monthly salary applies.</p>;
  }

  const cell = (d: Day, key: Part["key"]) => {
    const p = d.parts.find((x) => x.key === key);
    const done = d.done ? (key === "call" ? d.done.call_secs : key === "trial" ? d.done.trial : d.done.regular) : null;
    const show = (v: number) => (key === "call" ? hm(v) : String(v));
    if (!p) return <span style={{ color: C.muted }} title="Not ticked: doesn't count for the salary">{done === null ? "—" : show(done)}</span>;
    const color = p.quarters === 4 ? C.green : p.quarters === 0 ? C.red : C.orange;
    return (
      <span style={{ whiteSpace: "nowrap" }}>{show(p.done)} <span style={{ color: C.muted }}>/ {show(p.target)}</span>{" "}
        <b style={{ color, fontSize: 11.5 }}>{STEP[p.quarters]}</b></span>
    );
  };

  const th = { textAlign: "left", fontSize: 10.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, padding: "8px 10px", whiteSpace: "nowrap" } as const;
  const td = { padding: "8px 10px", fontSize: 13, color: C.textSub, borderTop: `1px solid ${C.borderLight}`, verticalAlign: "middle" } as const;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* the month's totals, exactly as the server worked them out */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13.5, color: C.textSub }}>
        <span>Salary earned: <b style={{ color: C.text }}>{inr(data.base)}</b> · {data.days_so_far} of {data.working_days} working days so far</span>
        <span>Commission: <b style={{ color: C.text }}>{inr(data.commission)}</b></span>
        {data.extras.length > 0 && <span style={{ color: C.green }}>Extras: <b>+{inr(data.extras.reduce((t, x) => t + x.amount, 0))}</b></span>}
        {data.deductions.length > 0 && <span style={{ color: C.red }}>Deductions: <b>−{inr(data.deductions.reduce((t, x) => t + x.amount, 0))}</b></span>}
        <span>Earned so far: <b style={{ color: C.text, fontSize: 15 }}>{inr(data.total)}</b></span>
      </div>
      {data.error && <p role="alert" style={{ margin: 0, color: C.red, fontSize: 13 }}>Payments didn&apos;t load ({data.error}): trial and regular joining may show 0.</p>}
      {err && <p role="alert" style={{ margin: 0, color: C.red, fontSize: 13 }}>{err}</p>}
      <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead style={{ background: C.bgDeep }}>
            <tr><th style={th}>Day</th><th style={th}>Calling</th><th style={th}>Trials</th><th style={th}>Share</th><th style={{ ...th, textAlign: "right" }}>Earned</th>{canOverride && <th style={th} />}</tr>
          </thead>
          <tbody>
            {data.days.map((d) => {
              const label = `${WD[d.weekday]} ${Number(d.day.slice(8))}`;
              const isToday = d.day === data.today;
              if (d.kind === "off" || d.kind === "holiday" || d.kind === "future") {
                return (
                  <tr key={d.day} style={{ color: C.muted, background: d.kind === "holiday" ? C.orangeLight : undefined }}>
                    <td style={{ ...td, color: C.muted }}>{label}</td>
                    <td style={{ ...td, color: C.muted }} colSpan={canOverride ? 5 : 4}>
                      {d.kind === "off" ? "Not a working day" : d.kind === "holiday" ? `Holiday · ${d.holiday}` : "—"}</td>
                  </tr>
                );
              }
              return (
                <tr key={d.day} style={{ background: isToday ? C.blueLight : undefined }}>
                  <td style={{ ...td, fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>{label}{isToday && <span style={{ color: C.blue, fontWeight: 600 }}> · today</span>}</td>
                  {d.kind === "away"
                    ? <td style={{ ...td, color: C.muted }} colSpan={2}>Not working here that day (before joining, or switched off)</td>
                    : <><td style={td}>{cell(d, "call")}</td><td style={td}>{cell(d, "trial")}</td></>}
                  <td style={{ ...td, whiteSpace: "nowrap" }} title={`${d.num} / ${d.den} of the day`}>
                    {d.kind === "away" ? "—" : d.countAsFull ? <b style={{ color: C.green }}>Full · set by Super Admin</b> : d.noTargets ? "Full · no targets ticked" : pct(d.num, d.den)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, color: d.paise ? C.text : C.muted, whiteSpace: "nowrap" }}>{inr(d.paise / 100)}</td>
                  {canOverride && (
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {d.kind === "working" && (
                        <button type="button" disabled={busy === d.day} onClick={() => setFull(d.day, !d.countAsFull)}
                          style={{ border: `1px solid ${d.countAsFull ? C.border : C.orangeBdr}`, background: d.countAsFull ? C.card : C.orangeLight, color: d.countAsFull ? C.textSub : C.orange,
                            borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          {busy === d.day ? "…" : d.countAsFull ? "Undo" : "Count as full"}</button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
        Day salary = fixed salary ÷ {data.working_days} working days. Targets: calling time and trial joining. Any ticked target met (100 %) → the full day; otherwise the best one decides: 50 % or more → half the day, under 50 % → ₹0. None ticked: the full day. Today moves live; past days use the targets they had.</p>
    </div>
  );
}
