"use client";

// My Dashboard: a User's home, and their salary page in one (client, 13 Nov 2026). With `id` it is the
// Super Admin's eye on that user's dashboard (Employee Tracker → View). Left: who they are
// and their salary plan, as a clean card. Right: today's targets (what is done, what is left), their
// calls for the picked period, and what they earned in it. Figures are their own only (the API forces it).
import DaysView from "@/components/salary/DaysView";
import Link from "next/link";
import useSWR from "swr";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { fetcher } from "@/lib/api";
import { usePeriodRange } from "@/hooks/usePeriodRange";
import PeriodSelect from "@/components/ui/PeriodSelect";
import { Funnel, HourLine, Panel, R, dur, initials } from "@/components/report/kit";
import { extraText, isActive } from "@/components/users/ExtraCommissions";
import { inr } from "@/lib/money";
import { istToday } from "@/lib/period";
import type { ExtraCommission, ExtraDeduction, ReportData } from "@callflow/shared-types";

type PaymentRow = {
  id: string; name: string; paid_date: string; mode: string; fee_type: string; linked_to: string;
  amount: number; commission: number; trial: boolean; receipt_url: string | null;
};
type PeriodEarning = { from: string; to: string; salary: number | null; commission: number; fees: number };
type Summary = {
  name: string; phone: string | null; email: string; employee_code: number; designation: string | null;
  fix_salary: number;
  trial_commission: number; trial_commission_type: "pct" | "fix"; regular_commission: number; regular_commission_type: "pct" | "fix";
  extra_commissions: ExtraCommission[]; extra_deductions: ExtraDeduction[];
  line_number: string | null; intercom_code: string | null; calling_number: string | null;
  target_call_secs: number; target_trial: number; target_regular: number;
  status: "active" | "inactive";
  /** The day a switched-off rep left ("YYYY-MM-DD"); null while active. */
  left_on: string | null;
  /** The day the targets box shows: the day picked, or today for a longer period. Its targets are the saved ones once the day has closed. */
  today: {
    date: string; is_today: boolean; final: boolean; call_secs: number; trial: number; regular: number;
    targets: { call_secs: number; trial: number; regular: number; tick_call: boolean; tick_trial: boolean; tick_regular: boolean };
    /** daily pay only: that day's share and salary, exactly as the Days view and the Employee Tracker count it */
    pay: { kind: "working" | "away"; num: number; den: number; salary: number; count_as_full: boolean; parts: { key: "call" | "trial" | "regular"; quarters: number }[] } | null;
  };
  earnings: PeriodEarning;
  /** a longer period: how often each ticked target was met (null when one day is picked) */
  period: PeriodTargets | null;
  income: { joinings: number; trial: number; regular: number; total: number; trial_count: number; regular_count: number; fees: number };
  payments: { connected: boolean; error: string | null; list: PaymentRow[] };
  /** The month's pay, as the Employee Tracker works it out (month of the picked period's end). */
  pay: {
    month: string; base: number; total: number;
    /** daily salary (15 Nov 2026): "daily" = salary earned on working days so far; same numbers as the tracker and Days */
    mode: "monthly" | "daily"; working_days: number | null; days_so_far: number | null;
    /** month close (client, 17 Nov 2026) */
    final: boolean; open_until: string | null;
    trial: { count: number; commission: number }; regular: { count: number; commission: number };
    extras: { name: string; amount: number }[]; deductions: { name: string; amount: number }[];
  };
};

const CSS = `
  .me-earn{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:24px;align-items:start}
  @media (max-width:900px){.me-earn{grid-template-columns:minmax(0,1fr)}}
  .me{display:grid;grid-template-columns:340px minmax(0,1fr);gap:16px;align-items:start}
  .me-4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .me-2{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px}
  .me-tg{display:grid;grid-template-columns:auto minmax(0,1fr);gap:22px;align-items:center}
  @media (max-width:760px){.me-tg{grid-template-columns:minmax(0,1fr)}}
  .me-det{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 40px}
  @media (max-width:800px){.me-det{grid-template-columns:minmax(0,1fr)}}
  @media (max-width:1150px){.me{grid-template-columns:minmax(0,1fr)}.me-4{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (max-width:700px){.me-2{grid-template-columns:minmax(0,1fr)}}
`;
const capLabel: CSSProperties = { fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700, color: R.mute };
const rate = (n: number, t: "pct" | "fix") => (t === "pct" ? `${n}% of fee` : `${inr(n)} each`);
const fmtTill = (d: string) => new Date(`${d}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const hm = (secs: number) => `${Math.floor(secs / 3600)}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}m`;
/** Exact time to the second (client: numbers must be exact): 5h 55m 52s, 4m 08s, 0s. */
const hms = (secs: number) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), sec = secs % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
};
/** Percent done, rounded DOWN: it reads 100 % only when the target is really met (99.6 % stays 99 %). */
const pctDone = (done: number, target: number) => (target > 0 ? Math.min(100, Math.floor((done * 100) / target)) : 0);
// one target's step (client, 17 Nov 2026): any target met → full day, else the best one: 50 %+ → ½ day
const STEP: Record<number, string> = { 0: "under 50 %", 2: "50 %+ · ½ day", 4: "met · full day" };
const dayLabel = (d: string) => new Date(`${d}T00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** One line of the profile card: label on the left, value on the right (the client's reference). */
/** One line of a Details list: label on the left, value on the right, a hairline between lines. */
function Line({ label, children, tone }: { label: string; children: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, padding: "10px 0", borderBottom: "1px solid #f1e8da", minWidth: 0 }}>
      <span style={{ fontSize: 13, color: R.mute, whiteSpace: "nowrap" }}>{label}</span>
      <b style={{ fontSize: 14, color: tone === "bad" ? R.bad : tone === "good" ? R.good : R.ink, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</b>
    </div>
  );
}

/** Done of target with a bar, and how many are still pending. */
function Progress({ label, done, goal }: { label: string; done: number; goal: number }) {
  const met = goal > 0 && done >= goal;
  return (
    <div style={{ background: "#faf7f2", border: "1px solid #f1e8da", borderRadius: 12, padding: "12px 14px" }}>
      <div style={capLabel}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, margin: "4px 0 6px" }}>{done} <span style={{ fontSize: 14, fontWeight: 600, color: R.mute }}>/ {goal || "—"}</span></div>
      <div style={{ height: 8, borderRadius: 4, background: "#efe4d3", overflow: "hidden" }}>
        <div style={{ width: `${goal ? Math.min(100, (done / goal) * 100) : 0}%`, height: "100%", background: met ? R.good : R.out, borderRadius: 4 }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: !goal ? R.mute : met ? R.good : R.bad }}>
        {!goal ? "No target set" : met ? "Target met ✓" : `Pending ${goal - done}`}</div>
    </div>
  );
}

const monthName = (ym: string) => new Date(`${ym}-01T00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const fmtDay = (d: string) => new Date(`${d}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The payments table; long lists open 25 at a time. */
function Payments({ rows }: { rows: PaymentRow[] }) {
  const [shown, setShown] = useState(25);
  const th: CSSProperties = { textAlign: "left", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: R.mute, background: R.soft, padding: "9px 10px", fontWeight: 600, whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "10px", borderBottom: "1px solid #f1e8da", whiteSpace: "nowrap" };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr>{["Date", "Student", "Fee", "Mode", "Amount", "Commission", "Receipt"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{rows.slice(0, shown).map((p) => (
            <tr key={p.id}>
              <td style={td}>{fmtDay(p.paid_date)}</td>
              <td style={{ ...td, whiteSpace: "normal", fontWeight: 600 }}>{p.name || "—"}</td>
              <td style={td}><span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "3px 9px",
                color: p.trial ? "#2f6fd6" : "#0f7f77", background: p.trial ? "#e6eefb" : "#e0f3f1" }}>{p.fee_type || "—"}</span></td>
              <td style={td}>{p.mode || "—"}</td>
              <td style={{ ...td, fontWeight: 700 }}>{inr(p.amount)}</td>
              <td style={{ ...td, fontWeight: 700, color: R.good }}>{inr(p.commission)}</td>
              <td style={td}>{p.receipt_url ? <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" style={{ color: R.out, fontWeight: 700 }}>View</a> : <span style={{ color: R.mute }}>—</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {rows.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + 25)}
          style={{ justifySelf: "center", padding: "8px 16px", borderRadius: 10, border: `1px solid ${R.line}`, background: "#fff", fontWeight: 700, fontSize: 13, color: R.ink, cursor: "pointer", fontFamily: "inherit" }}>
          Show more ({rows.length - shown} left)</button>
      )}
    </div>
  );
}

const tile = (bg: string): CSSProperties => ({ background: bg, color: "#fff", borderRadius: 14, padding: "14px 16px", minWidth: 0 });

/** The calling-time ring: filled to the exact share done (rounded down), no hover numbers to disagree with. */
/** Ring colour (client, 15 Nov 2026): red below 50 %, orange 50 % to under 100 %, green at 100 %. */
const ringColour = (pct: number) => (pct >= 100 ? R.good : pct >= 50 ? R.out : R.bad);

function Ring({ pct }: { pct: number }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg width={140} height={140} viewBox="0 0 140 140" role="img" aria-label={`${pct}% of the calling target`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#efe4d3" strokeWidth="14" />
      {pct > 0 && <circle cx="70" cy="70" r={r} fill="none" stroke={ringColour(pct)} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 70 70)" />}
      <text x="70" y="72" textAnchor="middle" fontSize="26" fontWeight="800" fill={R.ink}>{pct}%</text>
      <text x="70" y="92" textAnchor="middle" fontSize="11" fill={R.mute}>of calling time</text>
    </svg>
  );
}

type PeriodTargets = { too_long: true } | {
  too_long: false; from: string; to: string; working_days: number;
  targets: { key: "call" | "trial" | "regular"; met: number; of: number; days: { day: string; quarters: number }[] }[];
  salary: { earned: number; possible: number } | null;
};
const TARGET_NAME = { call: "Calling time", trial: "Trial joining", regular: "Regular joining" } as const;
const dotColour = (q: number) => (q === 4 ? R.good : q ? R.out : R.bad);

/**
 * A longer period (client, 16 Nov 2026): not a summed-up target (pay is per day, so a "100 % week" could hide ₹0
 * days) but how many working days each ticked target was met, one dot per day, and the salary those days earned.
 */
function PeriodTargetsBox({ p, label }: { p: PeriodTargets; label: string }) {
  if (p.too_long) return <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>Pick a period of up to 3 months to see how often the targets were met.</p>;
  if (p.working_days === 0) return <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>No working days in {label}.</p>;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {p.targets.length === 0 && <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>No targets were ticked on these {p.working_days} working days: each counts as a full day.</p>}
      {p.targets.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12 }}>
        {p.targets.map((t) => {
          const pct = Math.floor((t.met * 100) / t.of);
          return (
            <div key={t.key} style={{ background: "#faf7f2", border: "1px solid #f1e8da", borderRadius: 12, padding: "12px 14px", display: "grid", gap: 8 }}>
              <div style={capLabel}>{TARGET_NAME[t.key]}</div>
              <div style={{ fontSize: 14 }}>Met on <b style={{ fontSize: 24 }}>{t.met}</b> <span style={{ color: R.mute }}>of {t.of} working day{t.of === 1 ? "" : "s"}</span></div>
              <div style={{ height: 8, borderRadius: 4, background: "#efe4d3", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: ringColour(pct), borderRadius: 4 }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }} aria-label={`${TARGET_NAME[t.key]} day by day`}>
                {t.days.map((d) => (
                  <span key={d.day} title={`${dayLabel(d.day)}: ${d.quarters === 4 ? "met" : d.quarters ? `${STEP[d.quarters]}` : "under 50 %"}`}
                    style={{ width: 11, height: 11, borderRadius: "50%", background: dotColour(d.quarters) }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>}
      {p.salary && (
        <div style={{ paddingTop: 12, borderTop: "1px solid #f1e8da", fontSize: 13.5 }}>
          Fixed base monthly salary earned in these days <b>{inr(p.salary.earned)}</b> <span style={{ color: R.mute }}>of {inr(p.salary.possible)} possible</span></div>
      )}
      {p.targets.length > 0 && <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: R.mute }}>
        <span><b style={{ color: R.good }}>●</b> met</span><span><b style={{ color: R.out }}>●</b> 50 %+ (½ day)</span><span><b style={{ color: R.bad }}>●</b> under 50 %</span>
        <span>Each day uses the targets it had · Sundays and holidays don&apos;t count</span>
      </div>}
    </div>
  );
}

const PERIOD_NAME: Record<string, string> = { week: "Last 7 days", month: "This month", last_month: "Last month", all: "All time" };

/** Beside the month total (client, 19 Nov 2026): the salary and commission earned in the period picked above. */
function PeriodEarningBox({ e, title, live }: { e: PeriodEarning; title: string; live: boolean }) {
  const line = (label: string, value: ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5, color: "#e9dccb" }}><span>{label}</span><b style={{ color: "#fff", whiteSpace: "nowrap" }}>{value}</b></div>
  );
  return (
    <div style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "14px 16px", display: "grid", gap: 10, alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ ...capLabel, color: "#e3b778" }}>{title}</span>
        {live && <span style={{ fontSize: 11, fontWeight: 800, color: "#f4a36b" }}>● Live</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{inr((e.salary ?? 0) + e.commission)}</div>
      {line("Salary", e.salary === null
        ? <span title="Salary by day shows for daily pay, for periods up to 3 months">—</span> : inr(e.salary))}
      {line(`Commission · ${e.fees} fee${e.fees === 1 ? "" : "s"}`, inr(e.commission))}
    </div>
  );
}

export default function UserDashboard({ id }: { id?: string }) {
  const { period, params, range, selectProps, setPeriod, setCustomFrom, setCustomTo } = usePeriodRange();
  const { data: s, error } = useSWR<Summary>(`/employees/${id ?? "me"}/summary?${params}`, fetcher, { keepPreviousData: true });
  // the API answers a User with their own report only
  const { data: rep } = useSWR<ReportData>(`/reports/data?employee_id=${id ?? "all"}&${params}`, fetcher, { keepPreviousData: true });
  const [details, setDetails] = useState(false);
  // a switched-off rep's dashboard is frozen at the day they left (client, 15 Nov 2026): it opens on their
  // leaving month up to that day, and only earlier dates can be picked
  const leftOn = s?.status === "inactive" ? s.left_on : null;
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    if (!leftOn || frozen) return;
    setFrozen(true); setPeriod("custom"); setCustomFrom(`${leftOn.slice(0, 7)}-01`); setCustomTo(leftOn);
  }, [leftOn, frozen, setPeriod, setCustomFrom, setCustomTo]);
  if (error) return <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p>;
  if (!s) return <p style={{ color: R.mute }}>Loading…</p>;
  const me = rep?.people[0];
  const daily = s.pay.mode === "daily";
  const T = s.today.targets;
  // calling time: one set of numbers for the ring, Done, Left and the step (all from the same seconds)
  const callPct = pctDone(s.today.call_secs, T.call_secs);
  const left = Math.max(0, T.call_secs - s.today.call_secs);
  const stepOf = (key: "call" | "trial" | "regular") => s.today.pay?.parts.find((x) => x.key === key)?.quarters;
  // only what is running today shows (client): ended and scheduled ones stay on the Users form
  const bonuses = (s.extra_commissions ?? []).filter(isActive);
  const cuts = (s.extra_deductions ?? []).filter(isActive);
  const my = (t: string) => (id ? t : `My ${t.toLowerCase()}`);
  const inactive = s.status === "inactive";
  // inactive: the targets box only for one picked day on or before the leaving day
  const oneDay = !!range.date_from && range.date_from === range.date_to;
  // one day picked → that day's targets box; a longer period → how often the targets were met (client, 16 Nov 2026)
  const showTargets = oneDay && (!inactive || !s.left_on || (range.date_to ?? "") <= s.left_on);
  const payClosed = inactive || s.pay.month < istToday().slice(0, 7);
  const dayTitle = s.today.is_today ? "Today's targets" : `Targets · ${fmtDay(s.today.date)}`;

  // daily pay: the shown day is a working day only when it has a pay row (not a weekly off day or a holiday)
  const workingDay = !!s.today.pay && s.today.pay.kind === "working";
  const stepBadge = (key: "call" | "trial" | "regular", ticked: boolean) => !daily || !workingDay ? null : !ticked
    ? <span style={{ fontSize: 11, fontWeight: 700, color: R.mute }}>not counted for salary</span>
    : <span style={{ fontSize: 11, fontWeight: 800, color: stepOf(key) === 4 ? R.good : stepOf(key) ? R.out : R.bad }}>{STEP[stepOf(key) ?? 0]}</span>;

  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gap: 16 }}>
      <style>{CSS}</style>
      {id && <Link href="/dashboard/salary" style={{ justifySelf: "start", fontSize: 13.5, fontWeight: 700, color: R.out, textDecoration: "none" }}>← Back to Employee Tracker</Link>}

      {/* ── Header: who, status, details, period ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span aria-hidden style={{ width: 48, height: 48, borderRadius: "50%", background: inactive ? "#b9b0a5" : R.out, color: "#fff", display: "grid", placeItems: "center", fontSize: 17, fontWeight: 800, flex: "none" }}>{initials(s.name)}</span>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {id ? `${s.name}'s Dashboard` : "My Dashboard"}
            {/* switched off on the Users tab → grey "Inactive" (client, 15 Nov 2026) */}
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", borderRadius: 999, padding: "4px 10px",
              color: inactive ? "#7d756c" : R.good, background: inactive ? "#ebe7e2" : "#e5efe0" }}>● {inactive ? "Inactive" : "Active"}</span>
          </h1>
          <div style={{ fontSize: 13, color: R.mute, marginTop: 2 }}>{id ? "As this user sees it" : `Hello ${s.name.split(" ")[0]}`} · {period === "all" ? "All time" : rep?.period ?? ""}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setDetails((v) => !v)} aria-expanded={details}
            style={{ padding: "9px 16px", borderRadius: 20, border: `1px solid ${R.line}`, background: "#fff", fontWeight: 700, fontSize: 14, color: R.ink, cursor: "pointer", fontFamily: "inherit" }}>
            {my("Details")} {details ? "▴" : "▾"}</button>
          <PeriodSelect {...selectProps} {...(inactive ? { only: ["custom" as const], max: s.left_on ?? undefined } : {})} />
        </div>
      </div>

      {/* ── Details (click to open): profile and salary plan ── */}
      {details && (
        <Panel title={my("Details")} sub="Profile and salary plan">
          <div className="me-det">
            <div>
              <div style={capLabel}>Profile</div>
              <Line label="Reg No.">{s.employee_code}</Line>
              <Line label="Designation">{s.designation || "—"}</Line>
              <Line label="Contact">{s.phone || "—"}</Line>
              <Line label="Email"><span title={s.email}>{s.email}</span></Line>
              <Line label="Line · Intercom">{s.line_number ? `${s.line_number} · ${s.intercom_code ?? "—"}` : "—"}</Line>
              <Line label="Calling number">{s.calling_number || "—"}</Line>
            </div>
            <div>
              <div style={capLabel}>Salary plan</div>
              <Line label="Fixed salary">{inr(s.fix_salary)} / month</Line>
              <Line label="Trial commission">{rate(s.trial_commission, s.trial_commission_type)}</Line>
              <Line label="Regular commission">{rate(s.regular_commission, s.regular_commission_type)}</Line>
              {bonuses.map((x, i) => <Line key={`b${i}`} label={x.name} tone="good"><span title={extraText(x)}>+{inr(x.amount)} · till {fmtTill(x.to)}</span></Line>)}
              {cuts.map((x, i) => <Line key={`d${i}`} label={x.name} tone="bad"><span title={extraText(x)}>−{x.type === "pct" ? `${x.amount}% of salary + commission` : inr(x.amount)} · till {fmtTill(x.to)}</span></Line>)}
            </div>
          </div>
        </Panel>
      )}

      {/* ── 1. Earnings at the top (client, 15 Nov 2026): one live card, the total in bold, then each part by name; beside it the period picked (client, 19 Nov 2026) ── */}
      <section aria-label={my("Earnings")} className="me-earn" style={{ background: `linear-gradient(160deg, #4a3527, ${R.espresso})`, color: "#fff", borderRadius: 14,
        padding: "18px 20px", boxShadow: "0 14px 30px -18px rgba(43,33,24,.7)" }}>
        <div style={{ display: "grid", gap: 12, alignContent: "start", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ ...capLabel, color: "#e3b778" }}>{inactive ? "Final payout" : payClosed ? "Pay" : "Earned so far"} · {monthName(s.pay.month)}</span>
            {!inactive && !payClosed && <span style={{ fontSize: 11, fontWeight: 800, color: "#f4a36b" }}>● Live</span>}
          </div>
          <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1 }}>{inr(s.pay.total)}</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6, fontSize: 13.5, color: "#e9dccb" }}>
            {[
              { name: `Fixed salary${daily && !inactive && !payClosed ? ` · ${s.pay.days_so_far} of ${s.pay.working_days} working days` : ""}`, amount: inr(s.pay.base), color: "#fff" },
              { name: `Trial commission · ${s.pay.trial.count} joining${s.pay.trial.count === 1 ? "" : "s"}`, amount: inr(s.pay.trial.commission), color: "#fff" },
              { name: `Regular commission · ${s.pay.regular.count} joining${s.pay.regular.count === 1 ? "" : "s"}`, amount: inr(s.pay.regular.commission), color: "#fff" },
              ...s.pay.extras.map((x) => ({ name: x.name, amount: `+${inr(x.amount)}`, color: "#9fd18b" })),
              ...s.pay.deductions.map((x) => ({ name: x.name, amount: `−${inr(x.amount)}`, color: "#f2a69c" })),
            ].map((x, i) => (
              <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px dashed rgba(233,220,203,.18)", paddingBottom: 5 }}>
                <span>• {x.name}</span><b style={{ color: x.color, whiteSpace: "nowrap" }}>{x.amount}</b></li>
            ))}
          </ul>
          <div style={{ fontSize: 12, color: "#d9c8b4" }}>{inactive ? `Left on ${s.left_on ? fmtDay(s.left_on) : "—"} · nothing more is added`
            : payClosed ? (s.pay.final || !s.pay.open_until ? "This month has ended: final"
              : `Open until ${fmtDay(s.pay.open_until)}: late payments dated this month still count`)
            : `Paid at the end of the month${daily ? " · grows every working day" : ""}`}</div>
        </div>
        <PeriodEarningBox e={s.earnings} live={!inactive && s.earnings.to >= istToday()}
          title={period === "today" ? `Today · ${dayLabel(s.earnings.to)}` : period === "yesterday" ? `Yesterday · ${dayLabel(s.earnings.to)}`
            : PERIOD_NAME[period] ?? (s.earnings.from === s.earnings.to ? dayLabel(s.earnings.to) : `${dayLabel(s.earnings.from)} – ${dayLabel(s.earnings.to)}`)} />
      </section>

      {/* ── 2. Targets: today live, or a closed day with its saved targets ── */}
      {!oneDay && s.period && (
        <Panel title={`Targets · ${period === "all" ? "all time" : rep?.period ?? "the period picked"}`} sub="How many working days each target was met (each day is paid on its own)">
          <PeriodTargetsBox p={s.period} label="this period" />
        </Panel>
      )}
      {showTargets && <Panel title={dayTitle} sub={s.today.final ? "This day has closed: its targets and results are final" : "Updates live through the day"}>
        <div className="me-tg">
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            {T.call_secs ? <Ring pct={callPct} /> : <div style={{ width: 140, textAlign: "center", color: R.mute, fontSize: 13 }}>No calling target</div>}
            <div style={{ display: "grid", gap: 8, fontSize: 13.5 }}>
              <div style={capLabel}>Calling duration</div>
              <div>Done <b>{hms(s.today.call_secs)}</b></div>
              <div>Left <b style={{ color: left ? R.bad : R.good }}>{T.call_secs ? (left ? hms(left) : "0 · target met ✓") : "—"}</b></div>
              <div style={{ color: R.mute }}>Target <b style={{ color: R.ink }}>{T.call_secs ? hms(T.call_secs) : "not set"}</b></div>
              {stepBadge("call", T.tick_call && T.call_secs > 0)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
            <div style={{ display: "grid", gap: 4 }}><Progress label="Trial joining" done={s.today.trial} goal={T.trial} />{stepBadge("trial", T.tick_trial && T.trial > 0)}</div>
          </div>
        </div>
        {daily && !s.today.pay && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1e8da", fontSize: 13.5, color: R.mute }}>
            Not a working day (a weekly off day or a holiday): the targets don&apos;t count for salary today.</div>
        )}
        {daily && s.today.pay && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1e8da", display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13.5 }}>
            <span>Fixed base monthly salary for this day: <b>{inr(s.today.pay.salary)}</b></span>
            <span style={{ color: R.mute }}>{s.today.pay.kind === "away" ? "not working here that day" : s.today.pay.count_as_full ? "counted as full by the Super Admin"
              : s.today.pay.parts.length === 0 ? "no targets ticked: full day" : `${Math.floor((s.today.pay.num * 1000) / s.today.pay.den) / 10}% of the day salary`}</span>
          </div>
        )}
      </Panel>}

      {/* ── 3. Calls in the picked period ── */}
      <div className="me-4">
        <div style={tile(R.espresso)}>
          <div style={{ ...capLabel, color: "#e9dccb" }}>Total calls</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 2px" }}>{me?.calls ?? 0}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{me?.inb ?? 0} in · {me?.out ?? 0} out</div>
        </div>
        <div style={tile("#b85a2a")}>
          <div style={{ ...capLabel, color: "#fde9da" }}>Talk time</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 2px" }}>{dur(me?.dur ?? 0)}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>avg {dur(me?.avg ?? 0)} a call</div>
        </div>
        <div style={tile("#9a6a2c")}>
          <div style={{ ...capLabel, color: "#f6e7cf" }}>Real conversations</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 2px" }}>{me?.funnel?.[2] ?? 0}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>calls of 30 s or more</div>
        </div>
        <div style={tile("#7a5a44")}>
          <div style={{ ...capLabel, color: "#efe2d4" }}>Invalid numbers</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 2px" }}>{me?.invalid ?? 0}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>numbers that could not be right</div>
        </div>
      </div>

      {/* ── 4. Conversions: trial and regular joinings, with the fees ── */}
      <Panel title={my("Conversions")} sub={`Trial and regular joinings · ${period === "all" ? "all time" : rep?.period ?? "the period picked"}`}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline", fontSize: 14, marginBottom: 12 }}>
          <span>Trial joined <b style={{ fontSize: 18 }}>{s.income.trial_count}</b> <span style={{ color: R.mute }}>· {inr(s.income.trial)} commission</span></span>
          <span>Regular joined <b style={{ fontSize: 18 }}>{s.income.regular_count}</b> <span style={{ color: R.mute }}>· {inr(s.income.regular)} commission</span></span>
        </div>
        {s.payments.error ? <p role="alert" style={{ margin: 0, color: R.bad, fontSize: 13.5 }}>Couldn&apos;t load payments: {s.payments.error}</p>
          : !s.payments.connected ? <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>Payments from the school site are not connected yet.</p>
          : s.payments.list.length === 0 ? <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>No joinings in this period. Pick another period above.</p>
          : <Payments rows={s.payments.list} />}
      </Panel>

      {/* ── 5. Busiest hours and the call funnel, side by side ── */}
      <div className="me-2">
        <Panel title={my("Calls through the day")} sub="Calls per hour · hover a point">
          {rep && me ? <HourLine hours={rep.hours} values={me.hours} height={200} />
            : <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>No calls in this period. Pick another period above.</p>}
        </Panel>
        <Panel title={my("Call funnel")} sub="From dialled to real conversation">
          {me ? <Funnel f={me.funnel} /> : <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>No calls in this period.</p>}
        </Panel>
      </div>

      {/* ── 6. Daily pay: the month day by day (same numbers as the earnings above and the Employee Tracker) ── */}
      {daily && (
        <Panel title={my("Days")} sub={`${monthName(s.pay.month)} · what each working day earned`}>
          <DaysView employeeId={id} month={s.pay.month} />
        </Panel>
      )}
    </div>
  );
}
