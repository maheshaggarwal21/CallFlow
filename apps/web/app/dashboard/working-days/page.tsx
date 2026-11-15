"use client";

// Working Days tab (client, 15 Nov 2026; docs/salary-commission/EMPLOYEE-PAYMENT-FLOW.md): one place to tick the weekly
// working days, click any date to make it a holiday (or click a holiday to remove it), and choose the month daily pay
// starts from. For everyone. A day that isn't a working day, or is a holiday, isn't counted at all.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { C } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import { istToday } from "@/lib/period";
import { S } from "@/components/salary/kit";

type Settings = { weekdays: number[]; daily_pay_from: string | null; holidays: { day: string; name: string }[]; month: string; working_days: number; daily: boolean };
const NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthName = (ym: string) => new Date(`${ym}-01T00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const longDay = (d: string) => new Date(`${d}T00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shift = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const isoWeekday = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };

export default function WorkingDaysPage() {
  const today = istToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const { data, error, mutate } = useSWR<Settings>(`/pay/settings?month=${month}`, fetcher, { keepPreviousData: true });
  const [weekdays, setWeekdays] = useState<number[] | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [hName, setHName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data && weekdays === null) { setWeekdays(data.weekdays); setFrom(data.daily_pay_from); } }, [data, weekdays]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr(""); setSaved(false);
    try { await f(); await mutate(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };
  if (error) return <p role="alert" style={{ color: C.red }}>{(error as Error).message}</p>;
  if (!data || weekdays === null) return <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>;

  const holidays = new Map(data.holidays.map((h) => [h.day, h.name]));
  const dirty = JSON.stringify(weekdays) !== JSON.stringify(data.weekdays) || from !== data.daily_pay_from;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const lead = isoWeekday(days[0]) - 1;          // blank cells before the 1st (weeks start on Monday)
  const startOptions = Array.from({ length: 12 }, (_, i) => shift(today.slice(0, 7), i - 3));
  const pickedHoliday = picked ? holidays.get(picked) : undefined;

  const addHoliday = () => {
    if (!picked) return;
    if (!hName.trim()) return setErr("Give the holiday a name");
    run(() => api.post("/pay/holidays", { day: picked, name: hName.trim() })).then((ok) => { if (ok) { setHName(""); setPicked(null); } });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={S.h1}>Working Days</h1>
        <p style={S.sub}>The days salary is worked out on, for everyone. Day salary = fixed monthly salary ÷ the month&apos;s working days.</p>
      </div>

      {/* weekly pattern and the start month */}
      <section style={{ ...S.card, padding: "18px 22px", display: "grid", gap: 16 }}>
        <div>
          <div style={S.label}>Weekly working days</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => {
              const on = weekdays.includes(n);
              return (
                <label key={n} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
                  border: `1px solid ${on ? C.greenBdr : C.border}`, background: on ? C.greenLight : C.card, color: on ? C.green : C.textSub }}>
                  <input type="checkbox" checked={on} aria-label={NAMES[n]} style={{ accentColor: C.green }}
                    onChange={() => setWeekdays((w) => (w ?? []).includes(n) ? (w ?? []).filter((x) => x !== n) : [...(w ?? []), n].sort())} />{NAMES[n]}
                </label>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={S.label}>Daily pay starts from</span>
            <select value={from ?? ""} onChange={(e) => setFrom(e.target.value || null)} aria-label="Daily pay starts from" style={{ ...S.input, width: 260, background: C.card, fontSize: 14 }}>
              <option value="">Off (full monthly salary)</option>
              {startOptions.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || !dirty} onClick={() => run(() => api.put("/pay/settings", { weekdays, daily_pay_from: from })).then((ok) => ok && setSaved(true))}
            style={{ ...S.btnPrimary, opacity: busy || !dirty ? 0.55 : 1 }}>{busy ? "Saving…" : "Save"}</button>
          {saved && <span role="status" style={{ color: C.green, fontSize: 13, fontWeight: 700 }}>Saved ✓</span>}
          {dirty && !busy && <span style={{ color: C.orange, fontSize: 13, fontWeight: 600 }}>Not saved yet</span>}
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>Months before the start month keep the full monthly salary. Off = everyone gets the full monthly salary.</p>
      </section>

      {/* the month as a calendar: click a day to make it a holiday, click a holiday to remove it */}
      <section style={{ ...S.card, padding: "18px 22px", display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => { setMonth(shift(month, -1)); setPicked(null); }} aria-label="Previous month" style={S.btn}>‹</button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text, minWidth: 180, textAlign: "center" }}>{monthName(month)}</h2>
          <button type="button" onClick={() => { setMonth(shift(month, 1)); setPicked(null); }} aria-label="Next month" style={S.btn}>›</button>
          <span style={{ marginLeft: "auto", fontSize: 14, color: C.textSub }}>
            <b style={{ color: C.text, fontSize: 16 }}>{data.working_days}</b> working days{data.daily ? " · daily pay on" : " · daily pay off"}</span>
        </div>
        {dirty && <p style={{ margin: 0, fontSize: 12.5, color: C.orange }}>The calendar shows the saved working days; press Save above to apply your changes.</p>}
        <div role="grid" aria-label={`${monthName(month)} calendar`} style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => <div key={n} style={{ ...S.th, textAlign: "center", padding: "4px 0" }}>{NAMES[n]}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
          {days.map((d) => {
            const hol = holidays.get(d);
            const working = data.weekdays.includes(isoWeekday(d)) && !hol;
            const sel = picked === d;
            return (
              <button key={d} type="button" onClick={() => { setPicked(sel ? null : d); setErr(""); setHName(""); }} aria-pressed={sel}
                title={hol ? `Holiday: ${hol} (click to remove)` : working ? "Working day (click to make it a holiday)" : "Not a working day"}
                style={{ minHeight: 64, borderRadius: 10, cursor: "pointer", textAlign: "left", padding: "6px 8px", display: "grid", alignContent: "space-between", fontFamily: "inherit",
                  border: `${sel ? 2 : 1}px solid ${sel ? C.blue : hol ? C.orangeBdr : C.border}`,
                  background: hol ? C.orangeLight : working ? C.card : C.bgDeep }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: d === today ? C.blue : working || hol ? C.text : C.dim }}>{Number(d.slice(8))}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: hol ? C.orange : working ? C.green : C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {hol ? hol : working ? "Working" : "Off"}</span>
              </button>
            );
          })}
        </div>

        {picked && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "12px 14px", borderRadius: 12, background: C.bgDeep, border: `1px solid ${C.border}` }}>
            <b style={{ color: C.text, fontSize: 14 }}>{longDay(picked)}</b>
            {pickedHoliday !== undefined ? (
              <>
                <span style={{ color: C.orange, fontSize: 14 }}>Holiday · {pickedHoliday}</span>
                <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/pay/holidays/${picked}`)).then((ok) => ok && setPicked(null))}
                  style={{ ...S.btn, marginLeft: "auto", color: C.red, borderColor: C.red }}>Remove holiday</button>
              </>
            ) : (
              <>
                <input value={hName} maxLength={60} autoFocus onChange={(e) => setHName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addHoliday()}
                  placeholder="Holiday name, e.g. Diwali" aria-label="Holiday name" style={{ ...S.input, flex: "1 1 220px", background: C.card }} />
                <button type="button" disabled={busy} onClick={addHoliday} style={S.btnPrimary}>Make it a holiday</button>
              </>
            )}
          </div>
        )}
        {err && <p role="alert" style={{ margin: 0, color: C.red, fontSize: 13 }}>{err}</p>}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, color: C.muted }}>
          <span><b style={{ color: C.green }}>Working</b>: counted</span>
          <span><b style={{ color: C.orange }}>Holiday</b>: not counted (click it to remove)</span>
          <span><b style={{ color: C.dim }}>Off</b>: not a working weekday</span>
        </div>
      </section>

      {data.holidays.length > 0 && (
        <section style={{ ...S.card, padding: "16px 22px" }}>
          <div style={S.label}>All holidays</div>
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {data.holidays.map((h) => (
              <div key={h.day} style={{ display: "flex", gap: 12, fontSize: 13.5 }}>
                <b style={{ color: C.text, minWidth: 230 }}>{longDay(h.day)}</b><span style={{ color: C.textSub }}>{h.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
