"use client";

// My Dashboard: a User's home, and their salary page in one (client, 13 Nov 2026). With `id` it is the
// Super Admin's eye on that user's dashboard (Employee Tracker → View). Left: who they are
// and their salary plan, as a clean card. Right: today's targets (what is done, what is left), their
// calls for the picked period, and what they earned in it. Figures are their own only (the API forces it).
import DaysView from "@/components/salary/DaysView";
import Link from "next/link";
import useSWR from "swr";
import { useState, type CSSProperties, type ReactNode } from "react";
import { fetcher } from "@/lib/api";
import { usePeriodRange } from "@/hooks/usePeriodRange";
import PeriodSelect from "@/components/ui/PeriodSelect";
import { Funnel, HourLine, Panel, R, dur, initials } from "@/components/report/kit";
import { deductionValue, extraText, isActive } from "@/components/users/ExtraCommissions";
import { inr } from "@/lib/money";
import type { ExtraCommission, ExtraDeduction, ReportData } from "@callflow/shared-types";

type PaymentRow = {
  id: string; name: string; paid_date: string; mode: string; fee_type: string; linked_to: string;
  amount: number; commission: number; trial: boolean; receipt_url: string | null;
};
type Earning = { date: string; salary: number | null; kind: string | null; commission: number; fees: number };
type Summary = {
  name: string; phone: string | null; email: string; employee_code: number; designation: string | null;
  fix_salary: number;
  trial_commission: number; trial_commission_type: "pct" | "fix"; regular_commission: number; regular_commission_type: "pct" | "fix";
  extra_commissions: ExtraCommission[]; extra_deductions: ExtraDeduction[];
  line_number: string | null; intercom_code: string | null; calling_number: string | null;
  target_call_secs: number; target_trial: number; target_regular: number;
  status: "active" | "inactive";
  /** The day the targets box shows: the day picked, or today for a longer period. Its targets are the saved ones once the day has closed. */
  today: {
    date: string; is_today: boolean; final: boolean; call_secs: number; trial: number; regular: number;
    targets: { call_secs: number; trial: number; regular: number; tick_call: boolean; tick_trial: boolean; tick_regular: boolean };
    /** daily pay only: that day's share and salary, exactly as the Days view and the Employee Tracker count it */
    pay: { kind: "working" | "away"; num: number; den: number; salary: number; count_as_full: boolean; parts: { key: "call" | "trial" | "regular"; quarters: number }[] } | null;
  };
  earnings: { today: Earning | null; yesterday: Earning | null };
  income: { joinings: number; trial: number; regular: number; total: number; trial_count: number; regular_count: number; fees: number };
  payments: { connected: boolean; error: string | null; list: PaymentRow[] };
  /** The month's pay, as the Employee Tracker works it out (month of the picked period's end). */
  pay: {
    month: string; base: number; total: number;
    /** daily salary (15 Nov 2026): "daily" = salary earned on working days so far; same numbers as the tracker and Days */
    mode: "monthly" | "daily"; working_days: number | null; days_so_far: number | null;
    trial: { count: number; commission: number }; regular: { count: number; commission: number };
    extras: { name: string; amount: number }[]; deductions: { name: string; amount: number }[];
  };
};

const CSS = `
  .me{display:grid;grid-template-columns:340px minmax(0,1fr);gap:16px;align-items:start}
  .me-4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .me-2{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px}
  .me-earn{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr);gap:12px}
  @media (max-width:900px){.me-earn{grid-template-columns:minmax(0,1fr)}}
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
const STEP: Record<number, string> = { 0: "₹0 share", 2: "½ share", 3: "¾ share", 4: "full share" };
const dayLabel = (d: string) => new Date(`${d}T00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** One line of the profile card: label on the left, value on the right (the client's reference). */
function Row({ label, children, accent, minus }: { label: string; children: ReactNode; accent?: boolean; minus?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 12,
      background: minus ? "#fbeceb" : accent ? "#e8f3e2" : "#faf7f2", border: `1px solid ${minus ? "#f0c9c5" : accent ? "#bfdcb3" : "#f1e8da"}` }}>
      <span style={{ ...capLabel, fontSize: 10.5 }}>{label}</span>
      <b style={{ fontSize: 13.5, color: minus ? R.bad : accent ? R.good : R.ink, textAlign: "right", overflowWrap: "anywhere" }}>{children}</b>
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
function Ring({ pct, done }: { pct: number; done: boolean }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg width={140} height={140} viewBox="0 0 140 140" role="img" aria-label={`${pct}% of the calling target`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#efe4d3" strokeWidth="14" />
      {pct > 0 && <circle cx="70" cy="70" r={r} fill="none" stroke={done ? R.good : R.out} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 70 70)" />}
      <text x="70" y="72" textAnchor="middle" fontSize="26" fontWeight="800" fill={R.ink}>{pct}%</text>
      <text x="70" y="92" textAnchor="middle" fontSize="11" fill={R.mute}>of calling time</text>
    </svg>
  );
}

/** One earning card at the top: a day's salary (daily pay) and the commission on that day's fees. */
function EarningCard({ title, tag, e, daily }: { title: string; tag: string; e: Earning | null; daily: boolean }) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${R.line}`, borderRadius: 14, padding: "14px 16px", display: "grid", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={capLabel}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: tag === "Live" ? R.out : R.mute }}>{tag}</span>
      </div>
      {!e ? <div style={{ fontSize: 13.5, color: R.mute }}>Not in this month</div> : (
        <>
          <div style={{ fontSize: 13, color: R.mute }}>{dayLabel(e.date)}</div>
          {daily && <div style={{ fontSize: 26, fontWeight: 800 }}>{e.kind === "working" || e.kind === "away" ? inr(e.salary ?? 0) : "—"}
            <span style={{ fontSize: 12.5, fontWeight: 600, color: R.mute }}> salary{e.kind === "off" ? " · not a working day" : e.kind === "holiday" ? " · holiday" : ""}</span></div>}
          <div style={{ fontSize: daily ? 13.5 : 26, fontWeight: daily ? 600 : 800, color: daily ? R.ink : R.ink }}>{inr(e.commission)}
            <span style={{ fontSize: 12.5, fontWeight: 600, color: R.mute }}> commission on {e.fees} fee{e.fees === 1 ? "" : "s"}</span></div>
        </>
      )}
    </section>
  );
}

export default function UserDashboard({ id }: { id?: string }) {
  const { period, params, selectProps } = usePeriodRange();
  const { data: s, error } = useSWR<Summary>(`/employees/${id ?? "me"}/summary?${params}`, fetcher, { keepPreviousData: true });
  // the API answers a User with their own report only
  const { data: rep } = useSWR<ReportData>(`/reports/data?employee_id=${id ?? "all"}&${params}`, fetcher, { keepPreviousData: true });
  const [details, setDetails] = useState(false);
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
  const cuts = (s.extra_deductions ?? []).map((x) => ({ ...x, value: deductionValue(x, s.fix_salary) })).filter(isActive);
  const my = (t: string) => (id ? t : `My ${t.toLowerCase()}`);
  const inactive = s.status === "inactive";
  const extrasTotal = s.pay.extras.reduce((t, x) => t + x.amount, 0), cutsTotal = s.pay.deductions.reduce((t, x) => t + x.amount, 0);
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
          <PeriodSelect {...selectProps} />
        </div>
      </div>

      {/* ── Details (click to open): profile and salary plan ── */}
      {details && (
        <Panel title={my("Details")} sub="Profile and salary plan">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
            <Row label="Reg No.">{s.employee_code}</Row>
            <Row label="Designation">{s.designation || "—"}</Row>
            <Row label="Contact">{s.phone || "—"}</Row>
            <Row label="Email">{s.email}</Row>
            <Row label="Line · Intercom">{s.line_number ? `${s.line_number} · ${s.intercom_code ?? "—"}` : "—"}</Row>
            <Row label="Calling number">{s.calling_number || "—"}</Row>
            <Row label="Fix salary">{inr(s.fix_salary)} / month</Row>
            <Row label="Trial commission">{rate(s.trial_commission, s.trial_commission_type)}</Row>
            <Row label="Regular commission">{rate(s.regular_commission, s.regular_commission_type)}</Row>
            {bonuses.map((x, i) => <Row key={`b${i}`} label={`+ ${x.name}`} accent><span title={extraText(x)}>{inr(x.amount)} · till {fmtTill(x.to)}</span></Row>)}
            {cuts.map((x, i) => <Row key={`d${i}`} label={`− ${x.name}`} minus><span title={extraText(x)}>−{inr(x.value)}{x.type === "pct" ? ` (${x.amount}%)` : ""} · till {fmtTill(x.to)}</span></Row>)}
          </div>
        </Panel>
      )}

      {/* ── 1. Earnings at the top: the month so far, today (live) and yesterday (final) ── */}
      <div className="me-earn">
        <section aria-label={my("Earnings")} style={{ background: `linear-gradient(160deg, #4a3527, ${R.espresso})`, color: "#fff", borderRadius: 14, padding: "16px 20px",
          display: "grid", gap: 10, boxShadow: "0 14px 30px -18px rgba(43,33,24,.7)" }}>
          <div style={{ ...capLabel, color: "#e3b778" }}>{daily ? "Earned so far" : "Pay"} · {monthName(s.pay.month)}</div>
          <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1 }}>{inr(s.pay.total)}</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: "#e9dccb" }}>
            <span>Salary <b style={{ color: "#fff" }}>{inr(s.pay.base)}</b>{daily && ` · ${s.pay.days_so_far} of ${s.pay.working_days} days`}</span>
            <span>Commission <b style={{ color: "#fff" }}>{inr(s.pay.trial.commission + s.pay.regular.commission)}</b></span>
            {extrasTotal > 0 && <span>Extras <b style={{ color: "#9fd18b" }}>+{inr(extrasTotal)}</b></span>}
            {cutsTotal > 0 && <span>Deductions <b style={{ color: "#f2a69c" }}>−{inr(cutsTotal)}</b></span>}
          </div>
          <div style={{ fontSize: 12, color: "#d9c8b4" }}>Paid at the end of the month{daily ? " · grows every working day" : ""}</div>
        </section>
        <EarningCard title="Today" tag="Live" e={s.earnings.today} daily={daily} />
        <EarningCard title="Yesterday" tag="Final" e={s.earnings.yesterday} daily={daily} />
      </div>

      {/* ── 2. Targets: today live, or a closed day with its saved targets ── */}
      <Panel title={dayTitle} sub={s.today.final ? "This day has closed: its targets and results are final" : "Updates live through the day"}>
        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: 22, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {T.call_secs ? <Ring pct={callPct} done={s.today.call_secs >= T.call_secs} /> : <div style={{ width: 140, textAlign: "center", color: R.mute, fontSize: 13 }}>No calling target</div>}
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
            <div style={{ display: "grid", gap: 4 }}><Progress label="Regular joining" done={s.today.regular} goal={T.regular} />{stepBadge("regular", T.tick_regular && T.regular > 0)}</div>
          </div>
        </div>
        {daily && !s.today.pay && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1e8da", fontSize: 13.5, color: R.mute }}>
            Not a working day (a weekly off day or a holiday): the targets don&apos;t count for salary today.</div>
        )}
        {daily && s.today.pay && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1e8da", display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13.5 }}>
            <span>Salary for this day: <b>{inr(s.today.pay.salary)}</b></span>
            <span style={{ color: R.mute }}>{s.today.pay.kind === "away" ? "not working here that day" : s.today.pay.count_as_full ? "counted as full by the Super Admin"
              : s.today.pay.parts.length === 0 ? "no targets ticked: full day" : `${Math.floor((s.today.pay.num * 1000) / s.today.pay.den) / 10}% of the day salary`}</span>
          </div>
        )}
      </Panel>

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
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14, marginBottom: 12 }}>
          <span>Trial joined <b style={{ fontSize: 18 }}>{s.income.trial_count}</b> <span style={{ color: R.mute }}>· {inr(s.income.trial)} commission</span></span>
          <span>Regular joined <b style={{ fontSize: 18 }}>{s.income.regular_count}</b> <span style={{ color: R.mute }}>· {inr(s.income.regular)} commission</span></span>
          <span style={{ color: R.mute }}>Fees {inr(s.income.fees)}</span>
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
