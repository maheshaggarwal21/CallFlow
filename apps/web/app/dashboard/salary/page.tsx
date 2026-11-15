"use client";

// Super Admin: Employee Tracker. Each active User's pay for one month, from the school's payments
// (GET /employees/payroll): fix salary + other + trial and regular commission + extra commissions
// − deductions. The eye opens the rep's dashboard as they see it. Everyone else is sent home.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import DaysView from "@/components/salary/DaysView";
import { HOME } from "@/lib/tabs";
import { C } from "@/lib/colors";
import { fetcher } from "@/lib/api";
import { inr } from "@/lib/money";
import { istToday } from "@/lib/period";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, EyeButton, S } from "@/components/salary/kit";
import StatCard from "@/components/ui/StatCard";
import Tag from "@/components/ui/Tag";

type Bucket = { count: number; fees: number; commission: number };
type Row = {
  id: string; name: string; employee_code: number; color_index: number; error: string | null;
  /** Set when they were switched off during this month: listed greyed, salary for `days_paid` of `month_days`. */
  left_on: string | null; days_paid: number; month_days: number;
  /** daily salary (15 Nov 2026): "daily" = salary earned so far on working days; "monthly" = the full-month rule */
  mode: "monthly" | "daily"; working_days: number | null; days_so_far: number | null;
  trial: Bucket; regular: Bucket; commission: number; base: number;
  extras: { name: string; amount: number }[]; deductions: { name: string; amount: number }[]; total: number;
};
type Payroll = { month: string; connected: boolean; mode: "monthly" | "daily" | null; people: Row[] };
// money can have paise under daily pay: add in paise so a total never shows 0.1 + 0.2 = 0.30000000000000004
const addMoney = (xs: number[]) => Math.round(xs.reduce((t, x) => t + Math.round(x * 100), 0)) / 100;

// fits a 1280px laptop without sideways scrolling
const COLS = "minmax(190px,1.6fr) 1fr 1fr 0.9fr 0.9fr 1fr 1fr 168px";

/** This month and the 11 before it, newest first, as YYYY-MM. */
function lastMonths(): string[] {
  const [y, m] = istToday().split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
const monthName = (ym: string) => new Date(`${ym}-01T00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const sumOf = (xs: { amount: number }[]) => xs.reduce((t, x) => t + x.amount, 0);
const dayMonth = (d: string) => new Date(`${d}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Tracker() {
  const months = lastMonths();
  const [month, setMonth] = useState(months[0]);
  const { data, error, isLoading, mutate } = useSWR<Payroll>(`/employees/payroll?month=${month}`, fetcher, { keepPreviousData: true });
  const [daysOf, setDaysOf] = useState<{ id: string; name: string } | null>(null);
  const daily = data?.mode === "daily";
  // the running month under daily pay shows what has been earned up to today
  const soFar = daily && month === istToday().slice(0, 7);

  // best total first, so the table reads as a ranking; people who left this month go to the bottom
  const rows = [...(data?.people ?? [])].sort((a, b) => Number(!!a.left_on) - Number(!!b.left_on) || b.total - a.total);
  const sum = (f: (r: Row) => number) => addMoney(rows.map(f));
  const commission = sum((r) => r.commission);
  const top = rows.find((r) => r.commission > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={S.h1}>Employee Tracker</h1>
          <p style={S.sub}>Salary, commission, extras and deductions for each employee · {monthName(month)}
            {daily ? ` · daily pay${soFar ? ", earned up to today" : ""}` : ""}</p>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={S.label}>Month</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...S.input, width: 200, background: C.card, fontSize: 14 }}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        </div>
      </div>

      {error && <p role="alert" style={{ ...S.card, margin: 0, padding: 20, color: C.red }}>{(error as Error).message}</p>}
      {data && !data.connected && (
        <p role="status" style={{ ...S.card, margin: 0, padding: "14px 20px", fontSize: 14, color: C.textSub, borderColor: C.orangeBdr, background: C.orangeLight }}>
          Payments from the school site are not connected yet, so commission shows ₹0. Salary, extras and deductions are already counted.</p>
      )}

      {isLoading && !data ? <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>
        : rows.length === 0 ? <p style={{ ...S.card, margin: 0, padding: 28, fontSize: 14, color: C.muted }}>No active employees yet.</p>
        : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
            <StatCard label={soFar ? "Earned so far" : "Total payout"} value={inr(sum((r) => r.total))} icon="💰" accent={C.orange} sub={`${rows.length} employees · after extras and deductions`} />
            <StatCard label="Commission" value={inr(commission)} icon="📈" accent={C.green} sub={`on ${inr(sum((r) => r.trial.fees + r.regular.fees))} of fees collected`} />
            <StatCard label="Fees collected" value={String(sum((r) => r.trial.count + r.regular.count))} icon="🎓" accent={C.blue}
              sub={`${sum((r) => r.trial.count)} trial · ${sum((r) => r.regular.count)} regular`} />
            <StatCard label="Top earner" value={top ? top.name.split(" ")[0] : "—"} icon="🏆" accent={C.teal} sub={top ? `${inr(top.commission)} commission` : "No commission yet"} />
          </div>

          <div style={{ ...S.card, overflowX: "auto" }}>
            <div style={{ minWidth: 940 }}>
              <div style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 12, padding: "0 24px", minHeight: 44, borderBottom: `2px solid ${C.border}`, background: C.bgDeep }}>
                {["Employee", "Trial", "Regular", "Extras", "Deductions", "Salary", soFar ? "Earned so far" : "Total payout", ""].map((h, i) => <span key={i} style={S.th}>{h}</span>)}
              </div>
              {rows.map((r, i) => (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 12, padding: "16px 24px",
                  borderBottom: i === rows.length - 1 ? "none" : `1px solid ${C.borderLight}`, opacity: r.left_on ? 0.55 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                    <Avatar name={r.name} colorIndex={r.color_index} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: "0 0 2px", fontSize: 15.5, fontWeight: 700, color: C.text, overflowWrap: "anywhere" }}>{r.name}</p>
                      <p style={{ margin: 0, fontSize: 13, color: r.error ? C.red : C.muted, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {r.error ? "Payments didn't load" : `Reg No. ${r.employee_code}`}
                        {r.left_on && <Tag label={`Left ${dayMonth(r.left_on)}`} color={C.muted} bg={C.bgDeep} style={{ fontSize: 11 }} />}
                      </p>
                    </div>
                  </div>
                  <Money count={r.trial.count} amount={r.trial.commission} color={C.blue} bg={C.blueLight} />
                  <Money count={r.regular.count} amount={r.regular.commission} color={C.teal} bg={C.tealLight} />
                  <span title={r.extras.map((x) => `${x.name} +${inr(x.amount)}`).join("\n")} style={{ fontSize: 14.5, fontWeight: 600, color: r.extras.length ? C.green : C.muted }}>
                    {r.extras.length ? `+${inr(sumOf(r.extras))}` : "—"}</span>
                  <span title={r.deductions.map((x) => `${x.name} −${inr(x.amount)}`).join("\n")} style={{ fontSize: 14.5, fontWeight: 600, color: r.deductions.length ? C.red : C.muted }}>
                    {r.deductions.length ? `−${inr(sumOf(r.deductions))}` : "—"}</span>
                  <span style={{ fontSize: 14.5, color: C.textSub }}>{inr(r.base)}
                    {r.mode === "daily"
                      ? <span style={{ display: "block", fontSize: 12, color: C.muted }}>{r.days_so_far} of {r.working_days} working days</span>
                      : r.left_on && r.days_paid < r.month_days && <span style={{ display: "block", fontSize: 12, color: C.muted }}>for {r.days_paid} of {r.month_days} days</span>}</span>
                  <span style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{inr(r.total)}</span>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    {r.mode === "daily" && <button type="button" onClick={() => setDaysOf({ id: r.id, name: r.name })} title={`${r.name}'s days`}
                      style={{ ...S.btn, padding: "8px 12px", border: `1px solid ${C.orangeBdr}`, color: C.orange }}>Days</button>}
                    <EyeButton id={r.id} name={r.name} /></div>
                </div>
              ))}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>
            Trial and Regular: number of fees collected and the commission on them. An extra or deduction is paid once, in the month it starts; hover to see each one. Someone switched off this month is greyed at the bottom: salary for the days they worked, and commission on the fees up to the day they left.
            {daily && " Daily pay: salary = fixed salary ÷ working days × each working day's share from the ticked targets; Days shows every day."}</p>
        </>
      )}

      {daysOf && (
        <>
          <div onClick={() => setDaysOf(null)} style={{ position: "fixed", inset: 0, background: "rgba(43,33,24,0.35)", zIndex: 200 }} />
          <div role="dialog" aria-label={`${daysOf.name}'s days`} style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 201,
            width: "min(980px, calc(100vw - 32px))", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: "22px 26px", boxShadow: "0 24px 60px -20px rgba(43,33,24,0.35)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>{daysOf.name} · {monthName(month)}</h3>
              <button type="button" onClick={() => setDaysOf(null)} style={{ ...S.btn, marginLeft: "auto" }}>Close</button>
            </div>
            <DaysView employeeId={daysOf.id} month={month} canOverride onChanged={() => mutate()} />
          </div>
        </>
      )}
    </div>
  );
}

function Money({ count, amount, color, bg }: { count: number; amount: number; color: string; bg: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 600, color: C.text }}>
      <Tag label={String(count)} color={color} bg={bg} /> {inr(amount)}
    </span>
  );
}

export default function SalaryPage() {
  const { id, isOwner, isLoading } = useAuth();
  const router = useRouter();
  // everyone else's pay is on their own dashboard
  useEffect(() => { if (!isLoading && id && !isOwner) router.replace(HOME); }, [isLoading, id, isOwner, router]);
  if (isLoading || !id || !isOwner) return <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>;
  return <Tracker />;
}
