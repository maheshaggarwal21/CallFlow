"use client";

// My Dashboard: a User's home, and their salary page in one (client, 13 Nov 2026). With `id` it is the
// Super Admin's eye on that user's dashboard (Employee Tracker → View). Left: who they are
// and their salary plan, as a clean card. Right: today's targets (what is done, what is left), their
// calls for the picked period, and what they earned in it. Figures are their own only (the API forces it).
import Link from "next/link";
import useSWR from "swr";
import { useState, type CSSProperties, type ReactNode } from "react";
import { fetcher } from "@/lib/api";
import { usePeriodRange } from "@/hooks/usePeriodRange";
import PeriodSelect from "@/components/ui/PeriodSelect";
import { Donut, Funnel, HourLine, Panel, R, dur, initials } from "@/components/report/kit";
import { deductionValue, extraText, isActive } from "@/components/users/ExtraCommissions";
import { inr } from "@/lib/money";
import type { ExtraCommission, ExtraDeduction, ReportData } from "@callflow/shared-types";

type PaymentRow = {
  id: string; name: string; paid_date: string; mode: string; fee_type: string; linked_to: string;
  amount: number; commission: number; trial: boolean; receipt_url: string | null;
};
type Summary = {
  name: string; phone: string | null; email: string; employee_code: number; designation: string | null;
  fix_salary: number; other_amount: number;
  trial_commission: number; trial_commission_type: "pct" | "fix"; regular_commission: number; regular_commission_type: "pct" | "fix";
  extra_commissions: ExtraCommission[]; extra_deductions: ExtraDeduction[];
  line_number: string | null; intercom_code: string | null; calling_number: string | null;
  target_call_secs: number; target_trial: number; target_regular: number;
  today: { call_secs: number; trial: number; regular: number };
  income: { joinings: number; trial: number; regular: number; total: number; trial_count: number; regular_count: number; fees: number };
  payments: { connected: boolean; error: string | null; list: PaymentRow[] };
};

const CSS = `
  .me{display:grid;grid-template-columns:340px minmax(0,1fr);gap:16px;align-items:start}
  .me-4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .me-2{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:14px}
  @media (max-width:1150px){.me{grid-template-columns:minmax(0,1fr)}.me-4{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (max-width:700px){.me-2{grid-template-columns:minmax(0,1fr)}}
`;
const capLabel: CSSProperties = { fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700, color: R.mute };
const rate = (n: number, t: "pct" | "fix") => (t === "pct" ? `${n}% of fee` : `${inr(n)} each`);
const fmtTill = (d: string) => new Date(`${d}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const hm = (secs: number) => `${Math.floor(secs / 3600)}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}m`;

/** One line of the profile card: label on the left, value on the right (the client's reference). */
function Row({ label, children, accent, minus }: { label: string; children: ReactNode; accent?: boolean; minus?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 12,
      background: minus ? "#fbeceb" : accent ? "#fdf1e7" : "#faf7f2", border: `1px solid ${minus ? "#f0c9c5" : accent ? "#f3d4b8" : "#f1e8da"}` }}>
      <span style={{ ...capLabel, fontSize: 10.5 }}>{label}</span>
      <b style={{ fontSize: 13.5, color: minus ? R.bad : accent ? R.out : R.ink, textAlign: "right", overflowWrap: "anywhere" }}>{children}</b>
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

export default function UserDashboard({ id }: { id?: string }) {
  const { period, params, selectProps } = usePeriodRange();
  const { data: s, error } = useSWR<Summary>(`/employees/${id ?? "me"}/summary?${params}`, fetcher, { keepPreviousData: true });
  // the API answers a User with their own report only
  const { data: rep } = useSWR<ReportData>(`/reports/data?employee_id=${id ?? "all"}&${params}`, fetcher, { keepPreviousData: true });
  if (error) return <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p>;
  if (!s) return <p style={{ color: R.mute }}>Loading…</p>;
  const me = rep?.people[0];
  const left = Math.max(0, s.target_call_secs - s.today.call_secs);
  // only what is running today shows (client): ended and scheduled ones stay on the Users form
  const bonuses = (s.extra_commissions ?? []).filter(isActive);
  const cuts = (s.extra_deductions ?? []).map((x) => ({ ...x, value: deductionValue(x, s.fix_salary) })).filter(isActive);
  const my = (t: string) => (id ? t : `My ${t.toLowerCase()}`);

  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gap: 16 }}>
      <style>{CSS}</style>
      {id && <Link href="/dashboard/salary" style={{ justifySelf: "start", fontSize: 13.5, fontWeight: 700, color: R.out, textDecoration: "none" }}>← Back to Employee Tracker</Link>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{id ? `${s.name}'s Dashboard` : "My Dashboard"}</h1>
          <div style={{ fontSize: 13, color: R.mute, marginTop: 2 }}>{id ? "As this user sees it" : `Hello ${s.name.split(" ")[0]}`} · {period === "all" ? "All time" : rep?.period ?? ""}</div>
        </div>
        <div style={{ marginLeft: "auto" }}><PeriodSelect {...selectProps} /></div>
      </div>

      <div className="me">
        {/* ── Profile and salary plan ── */}
        <aside style={{ background: "#fff", border: `1px solid ${R.line}`, borderRadius: 22, padding: "22px 20px", display: "grid", gap: 10,
          boxShadow: "0 10px 30px -18px rgba(43,33,24,.25)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 14, borderBottom: "1px solid #f1e8da" }}>
            <span aria-hidden style={{ width: 64, height: 64, borderRadius: "50%", background: R.out, color: "#fff", display: "grid", placeItems: "center",
              fontSize: 22, fontWeight: 800, flex: "none", boxShadow: "0 8px 18px -8px rgba(232,100,27,.7)" }}>{initials(s.name)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 800, overflowWrap: "anywhere" }}>{s.name}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: R.out, background: "#fdf1e7", borderRadius: 999, padding: "4px 10px" }}>{s.designation || "User"}</span>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: R.good, background: "#e5efe0", borderRadius: 999, padding: "4px 10px" }}>● Active</span>
              </div>
            </div>
          </div>
          <div style={{ ...capLabel, marginTop: 4 }}>{my("Details")}</div>
          <Row label="Reg No.">{s.employee_code}</Row>
          <Row label="Contact">{s.phone || "—"}</Row>
          <Row label="Email">{s.email}</Row>
          <Row label="Line · Intercom">{s.line_number ? `${s.line_number} · ${s.intercom_code ?? "—"}` : "—"}</Row>
          <Row label="Calling number">{s.calling_number || "—"}</Row>
          <div style={{ ...capLabel, marginTop: 8 }}>{my("Salary plan")}</div>
          <Row label="Fix salary">{inr(s.fix_salary)} / month</Row>
          <Row label="Trial commission">{rate(s.trial_commission, s.trial_commission_type)}</Row>
          <Row label="Regular commission">{rate(s.regular_commission, s.regular_commission_type)}</Row>
          {s.other_amount > 0 && <Row label="Other amount">{inr(s.other_amount)}</Row>}
          {bonuses.length + cuts.length > 0 && <div style={{ ...capLabel, marginTop: 8 }}>Active now</div>}
          {bonuses.map((x, i) => <Row key={`b${i}`} label={`+ ${x.name}`} accent><span title={extraText(x)}>{inr(x.amount)} · till {fmtTill(x.to)}</span></Row>)}
          {cuts.map((x, i) => <Row key={`d${i}`} label={`− ${x.name}`} minus><span title={extraText(x)}>−{inr(x.value)}{x.type === "pct" ? ` (${x.amount}%)` : ""} · till {fmtTill(x.to)}</span></Row>)}
        </aside>

        <main style={{ display: "grid", gap: 14, minWidth: 0 }}>
          {/* ── Today's targets ── */}
          <Panel title="Today's targets" sub="Set by the school · resets every day">
            <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: 22, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <Donut size={150} center={s.target_call_secs ? `${Math.min(100, Math.round((s.today.call_secs / s.target_call_secs) * 100))}%` : "—"} sub="of calling time"
                  slices={[{ label: "Done", value: s.today.call_secs, color: R.out }, { label: "Left", value: s.target_call_secs ? left : 0, color: "#efe4d3" }]} />
                <div style={{ display: "grid", gap: 10, fontSize: 13.5 }}>
                  <div style={capLabel}>Calling duration</div>
                  <div><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: R.out, marginRight: 7 }} />Done <b>{hm(s.today.call_secs)}</b></div>
                  <div><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#efe4d3", marginRight: 7 }} />Left <b style={{ color: left ? R.bad : R.good }}>{s.target_call_secs ? hm(left) : "—"}</b></div>
                  <div style={{ color: R.mute }}>Target <b style={{ color: R.ink }}>{s.target_call_secs ? hm(s.target_call_secs) : "not set"}</b></div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
                <Progress label="Trial joining" done={s.today.trial} goal={s.target_trial} />
                <Progress label="Regular joining" done={s.today.regular} goal={s.target_regular} />
              </div>
            </div>
          </Panel>

          {/* ── My calls in the picked period ── */}
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

          <div className="me-2">
            <Panel title={my("Calls through the day")} sub="Calls per hour · hover a point">
              {rep && me ? <HourLine hours={rep.hours} values={me.hours} height={200} />
                : <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>No calls in this period. Pick another period above.</p>}
            </Panel>
            {/* ── What they earned in the picked period (the old My Salary page): the dark card from the first version ── */}
            <section aria-label={my("Earnings")} style={{ background: `linear-gradient(160deg, #4a3527, ${R.espresso})`, color: "#fff", borderRadius: 14, padding: "18px 20px",
              display: "grid", alignContent: "space-between", gap: 14, boxShadow: "0 14px 30px -18px rgba(43,33,24,.7)" }}>
              <div>
                <div style={{ ...capLabel, color: "#e3b778" }}>{my("Earnings")}</div>
                <div style={{ fontSize: 13, color: "#d9c8b4", marginTop: 2 }}>For the period picked above</div>
              </div>
              <div>
                <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{inr(s.income.total)}</div>
                <div style={{ fontSize: 13, color: "#d9c8b4", marginTop: 6 }}>commission on {s.income.joinings} fee{s.income.joinings === 1 ? "" : "s"} collected · {inr(s.income.fees)}</div>
              </div>
              <div style={{ display: "grid", gap: 8, fontSize: 13.5, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.14)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#e9dccb" }}><span>Trial commission · {s.income.trial_count}</span><b style={{ color: "#fff" }}>{inr(s.income.trial)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#e9dccb" }}><span>Regular commission · {s.income.regular_count}</span><b style={{ color: "#fff" }}>{inr(s.income.regular)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#e9dccb" }}><span>Fix salary{s.other_amount ? " + other" : ""} / month</span><b style={{ color: "#e3b778" }}>{inr(s.fix_salary + s.other_amount)}</b></div>
                {bonuses.map((x, i) => <div key={`b${i}`} style={{ display: "flex", justifyContent: "space-between", color: "#e9dccb" }}><span>+ {x.name}</span><b style={{ color: "#9fd18b" }}>+{inr(x.amount)}</b></div>)}
                {cuts.map((x, i) => <div key={`d${i}`} style={{ display: "flex", justifyContent: "space-between", color: "#e9dccb" }}><span>− {x.name}</span><b style={{ color: "#f2a69c" }}>−{inr(x.value)}</b></div>)}
              </div>
            </section>
          </div>

          {/* ── Fees collected in the picked period, from the school site ── */}
          <Panel title={my("Fees collected")} sub="From the school's payments · the commission each one earned">
            {s.payments.error ? <p role="alert" style={{ margin: 0, color: R.bad, fontSize: 13.5 }}>Couldn&apos;t load payments: {s.payments.error}</p>
              : !s.payments.connected ? <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>Payments from the school site are not connected yet.</p>
              : s.payments.list.length === 0 ? <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>No fees collected in this period. Pick another period above.</p>
              : <Payments rows={s.payments.list} />}
          </Panel>

          <Panel title={my("Call funnel")} sub="From dialled to real conversation">
            {me ? <div style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}><Funnel f={me.funnel} /></div>
              : <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>No calls in this period.</p>}
          </Panel>
        </main>
      </div>
    </div>
  );
}
