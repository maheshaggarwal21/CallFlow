"use client";

import { useMemo, useState, useRef } from "react";
import useSWR from "swr";
import { C, eClr, init, fmtS } from "@/lib/colors";
import { fetcher, api } from "@/lib/api";
import { getStudentDisplay } from "@/lib/studentLabel";
import type { Call } from "@callflow/shared-types";
import { toLineChartData } from "@/lib/chartTransforms";
import PieChart from "@/components/ui/PieChart";
import LineChart from "@/components/ui/LineChart";
import GaugeMeter from "@/components/ui/GaugeMeter";
import type { OverviewStats } from "@callflow/shared-types";

// ── Stat card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, delta, accent = C.orange }: {
  label: string; value: string | number; sub?: string; icon: string; delta?: number | null; accent?: string;
}) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 16, padding: "24px 26px", boxShadow: C.shadow,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: accent + "18",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
        }}>{icon}</div>
      </div>
      <p style={{ margin: "0 0 6px", fontSize: 13, color: C.muted, fontWeight: 500, letterSpacing: 0.2 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 34, fontWeight: 700, color: C.text, lineHeight: 1, letterSpacing: -1 }}>{value}</p>
      {(sub || delta !== undefined) && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: delta != null ? (delta >= 0 ? C.green : C.red) : C.muted, fontWeight: 400 }}>
          {delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs last month` : sub}
        </p>
      )}
    </div>
  );
}

type Period = "today" | "yesterday" | "week" | "month" | "last_month" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today",      label: "Today" },
  { key: "yesterday",  label: "Yesterday" },
  { key: "week",       label: "Last 7 Days" },
  { key: "month",      label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "all",        label: "All Time" },
];

export default function OverviewPage() {
  const [period, setPeriod]                 = useState<Period>("month");
  const [csatEmployeeId, setCsatEmployeeId] = useState<string>("");
  const [playingId, setPlayingId]           = useState<string | null>(null);
  const [fetchingId, setFetchingId]         = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCache = useRef<Map<string, string>>(new Map());

  async function handlePlay(call: Call) {
    if (playingId === call.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
    }
    let audioUrl: string | null = urlCache.current.get(call.id) ?? call.audio_presigned_url ?? null;
    if (!audioUrl) {
      setFetchingId(call.id);
      try {
        const data = await api.get<Call>(`/calls/${call.id}`);
        audioUrl = data.audio_presigned_url ?? null;
        if (audioUrl) urlCache.current.set(call.id, audioUrl);
      } catch {
        // no audio
      } finally {
        setFetchingId(null);
      }
    }
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.play().catch(() => {});
    setPlayingId(call.id);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
  }

  const dateRange = useMemo(() => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const startOfDay = (d: Date) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
    const endOfDay   = (d: Date) => { const c = new Date(d); c.setHours(23, 59, 59, 999); return c; };

    switch (period) {
      case "today":
        return { date_from: fmt(startOfDay(today)), date_to: fmt(endOfDay(today)) };
      case "yesterday": {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        return { date_from: fmt(startOfDay(y)), date_to: fmt(endOfDay(y)) };
      }
      case "week": {
        const s = new Date(today); s.setDate(s.getDate() - 6);
        return { date_from: fmt(startOfDay(s)), date_to: fmt(endOfDay(today)) };
      }
      case "month": {
        const s = new Date(today.getFullYear(), today.getMonth(), 1);
        return { date_from: fmt(startOfDay(s)), date_to: fmt(endOfDay(today)) };
      }
      case "last_month": {
        const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const e = new Date(today.getFullYear(), today.getMonth(), 0);
        return { date_from: fmt(startOfDay(s)), date_to: fmt(endOfDay(e)) };
      }
      case "all":
      default:
        return { date_from: "2000-01-01" };
    }
  }, [period]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (dateRange.date_from) p.set("date_from", dateRange.date_from);
    if ("date_to" in dateRange && dateRange.date_to) p.set("date_to", dateRange.date_to);
    if (csatEmployeeId) p.set("employee_id", csatEmployeeId);
    const qs = p.toString();
    return `/analytics/overview${qs ? `?${qs}` : ""}`;
  }, [dateRange, csatEmployeeId]);

  const { data } = useSWR<OverviewStats>(query, fetcher);

  const inPct  = data?.direction_split.inbound_pct  ?? 0;
  const outPct = data?.direction_split.outbound_pct ?? 0;
  const csat   = data?.csat_score ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* Header + month picker */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Dashboard</h1>
          <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted, fontWeight: 400 }}>Overview · Max Music School</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PERIODS.map((p) => {
            const isA = period === p.key;
            return (
              <button key={p.key} onClick={() => setPeriod(p.key)} style={{
                padding: "8px 16px", borderRadius: 20,
                border: `1px solid ${isA ? C.orange : C.border}`,
                background: isA ? C.orange : "transparent",
                color: isA ? "#fff" : C.muted,
                cursor: "pointer", fontSize: 14, fontWeight: isA ? 700 : 500,
                transition: "all 0.15s", whiteSpace: "nowrap",
              }}>{p.label}</button>
            );
          })}
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <StatCard label="Total Calls"  value={data?.total_calls ?? "—"} icon="📞" accent={C.orange} delta={data?.mom_delta.total_pct ?? null} sub="Up 12% vs last month" />
        <StatCard label="Inbound"      value={data?.inbound ?? "—"}     icon="📥" accent={C.green}  delta={data?.mom_delta.inbound_pct ?? null} />
        <StatCard label="Outbound"     value={data?.outbound ?? "—"}    icon="📤" accent={C.teal}   delta={data?.mom_delta.outbound_pct ?? null} />
        <StatCard label="Avg Duration" value={data ? fmtS(data.avg_duration_secs) : "—"} icon="⏱" accent={C.blue} sub="average call length" />
      </div>

      {/* Direction Split + Team Split */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Call Direction Split */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: C.text }}>Call Direction Split</p>
          <p style={{ margin: "0 0 18px", fontSize: 12, color: C.muted }}>Inbound vs outbound this month</p>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <PieChart
              segments={[
                { value: inPct, color: C.green + "cc" },
                { value: outPct, color: C.orange + "cc" },
              ]}
              size={120}
              innerRadius={0.62}
              label={`${inPct.toFixed(0)}%`}
              sublabel="Inbound"
            />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { key: "inbound",  label: "Inbound",  val: data?.inbound ?? 0,  pct: inPct,  color: C.green },
                { key: "outbound", label: "Outbound", val: data?.outbound ?? 0, pct: outPct, color: C.orange },
              ].map((row) => (
                <div key={row.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: row.color + "cc" }} />
                      <span style={{ fontSize: 12, color: C.muted }}>{row.label}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{row.val}</span>
                  </div>
                  <div style={{ height: 5, background: C.bgDeep, borderRadius: 4 }}>
                    <div style={{ width: `${row.pct}%`, height: "100%", background: row.color + "cc", borderRadius: 4, transition: "width 0.4s" }} />
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted }}>{row.pct.toFixed(0)}% of total</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Team Split */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: C.text }}>Team Call Split</p>
          <p style={{ margin: "0 0 18px", fontSize: 12, color: C.muted }}>Calls handled per agent this month</p>
          {data?.team_split && data.team_split.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <PieChart
                segments={data.team_split.map((e) => ({ value: e.count, color: eClr(e.color_index).t + "cc" }))}
                size={120}
                innerRadius={0.62}
                label={String(data.total_calls)}
                sublabel="total"
              />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                {data.team_split.map((entry) => {
                  const clr = eClr(entry.color_index);
                  return (
                    <div key={entry.employee_id}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: 6,
                            background: clr.bg, border: `1.5px solid ${clr.br}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 8, fontWeight: 800, color: clr.t,
                          }}>{init(entry.name)}</div>
                          <span style={{ fontSize: 12, color: C.textSub }}>{entry.name.split(" ")[0]}</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{entry.count}</span>
                      </div>
                      <div style={{ height: 4, background: C.bgDeep, borderRadius: 4 }}>
                        <div style={{ width: `${entry.pct}%`, height: "100%", background: clr.t + "bb", borderRadius: 4, transition: "width 0.4s" }} />
                      </div>
                    </div>
                  );
                })}

                {data.team_split[0] && (
                  <div style={{
                    marginTop: 4, padding: "8px 10px",
                    background: C.orangeLight, border: `1px solid ${C.orangeBdr}`, borderRadius: 8,
                  }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: C.orange, textTransform: "uppercase", letterSpacing: 0.6 }}>KEY INSIGHT</p>
                    <p style={{ margin: "3px 0 0", fontSize: 11, color: C.textSub }}>
                      {data.team_split[0].name.split(" ")[0]} leads with {data.team_split[0].count} calls this month
                    </p>
                    {data.top_line && (
                      <p style={{ margin: "1px 0 0", fontSize: 11, color: C.textSub }}>
                        {data.top_line.line_number} is the highest traffic line this month
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : <p style={{ color: C.muted, fontSize: 13 }}>No data</p>}
        </div>
      </div>

      {/* Weekly Activity LINE CHART + Customer Satisfaction */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>

        {/* Line chart */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Weekly Activity</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>Call volume this week</p>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              {[{ label: "Inbound", color: C.orange }, { label: "Outbound", color: C.green }].map(l => (
                <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 20, height: 2, background: l.color, borderRadius: 2 }} />
                  <span style={{ fontSize: 11, color: C.muted }}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            {data?.weekly_activity ? (
              <LineChart data={toLineChartData(data.weekly_activity)} />
            ) : (
              <p style={{ color: C.muted, fontSize: 13 }}>No data</p>
            )}
          </div>
        </div>

        {/* Customer Satisfaction */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Customer Satisfaction</p>
            <select
              value={csatEmployeeId}
              onChange={(e) => setCsatEmployeeId(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: `1px solid ${C.border}`,
                background: C.card,
                fontSize: 12,
                color: C.textSub,
              }}
            >
              <option value="">Overall</option>
              {(data?.team_split ?? []).map((e) => (
                <option key={e.employee_id} value={e.employee_id}>{e.name}</option>
              ))}
            </select>
          </div>
          <p style={{ margin: "0 0 16px", fontSize: 12, color: C.muted }}>Based on call outcomes</p>

          <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
            <GaugeMeter value={csat} label={csatEmployeeId ? "Employee CSAT" : "Overall CSAT"} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{
              padding: "12px 14px", borderRadius: 12, textAlign: "center",
              background: C.greenLight, border: `1px solid ${C.greenBdr}`,
            }}>
              <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.green }}>{data?.resolved_count ?? "—"}</p>
              <p style={{ margin: "3px 0 0", fontSize: 11, color: C.green, fontWeight: 600 }}>Resolved</p>
            </div>
            <div style={{
              padding: "12px 14px", borderRadius: 12, textAlign: "center",
              background: C.redLight, border: `1px solid ${C.redBdr}`,
            }}>
              <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.red }}>{data?.escalated_count ?? "—"}</p>
              <p style={{ margin: "3px 0 0", fontSize: 11, color: C.red, fontWeight: 600 }}>Escalated</p>
            </div>
          </div>
        </div>
      </div>
      {/* Team Breakdown Grid */}
      {data?.team_split && data.team_split.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: C.text }}>Team Breakdown</p>
          <p style={{ margin: "0 0 16px", fontSize: 12, color: C.muted }}>Calls handled per agent this month</p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            {data.team_split.map((emp) => {
              const clr = eClr(emp.color_index);
              return (
                <div key={emp.employee_id} style={{
                  padding: "14px 16px",
                  background: C.bgDeep, border: `1px solid ${C.border}`,
                  borderRadius: 12, textAlign: "center",
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: clr.bg, border: `1.5px solid ${clr.br}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 800, color: clr.t,
                    margin: "0 auto 8px",
                  }}>{init(emp.name)}</div>
                  <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 700, color: C.text }}>
                    {emp.name.split(" ")[0]}
                  </p>
                  <p style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: clr.t }}>
                    {emp.count}
                  </p>
                  <div style={{ height: 3, background: C.bgDeep, borderRadius: 2 }}>
                    <div style={{
                      width: `${emp.pct}%`, height: "100%",
                      background: clr.t + "cc", borderRadius: 2,
                    }} />
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 10, color: C.muted }}>
                    {emp.pct.toFixed(0)}% of total
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Recent Calls */}
      {data?.recent_calls && data.recent_calls.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Recent Calls</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>Latest activity across all lines</p>
            </div>
            <a href="/dashboard/employees" style={{ fontSize: 12, color: C.orange, fontWeight: 600, textDecoration: "none" }}>
              View all &rarr;
            </a>
          </div>

          {/* Mini table header */}
          <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 1fr 1fr 68px 68px 72px 92px", gap: 0,
            borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 0 }}>
            {["", "NUMBER", "STUDENT", "AGENT", "LINE", "TYPE", "DUR", "TIME"].map(h => (
              <span key={h} style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, padding: "0 8px" }}>{h}</span>
            ))}
          </div>

          {data.recent_calls.slice(0, 6).map((call) => {
            const sd     = getStudentDisplay(call.caller_phone, call.student_name);
            const empClr = call.color_index !== null ? eClr(call.color_index) : null;
            const dt     = new Date(call.called_at);
            const isIn   = call.call_direction === "inbound";

            return (
              <div key={call.id} style={{
                display: "grid", gridTemplateColumns: "36px 1fr 1fr 1fr 68px 68px 72px 92px",
                alignItems: "center", padding: "11px 0",
                borderBottom: `1px solid ${C.borderLight}`,
              }}>
                <div style={{ padding: "0 8px", display: "flex", alignItems: "center" }}>
                  <button
                    onClick={() => handlePlay(call)}
                    title={fetchingId === call.id ? "Loading…" : playingId === call.id ? "Pause" : "Play recording"}
                    style={{
                      width: 28, height: 28, borderRadius: "50%", border: "none",
                      background: playingId === call.id
                        ? `linear-gradient(135deg,${C.orange},#f59e0b)`
                        : C.bgDeep,
                      boxShadow: playingId === call.id
                        ? "0 2px 8px rgba(232,118,26,0.35)"
                        : `inset 0 0 0 1.5px ${C.border}`,
                      cursor: fetchingId === call.id ? "wait" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, color: playingId === call.id ? "#fff" : C.muted,
                      flexShrink: 0, opacity: fetchingId === call.id ? 0.6 : 1,
                      transition: "all 0.18s",
                    }}
                  >
                    {fetchingId === call.id ? "⏳" : playingId === call.id ? "⏸" : "▶"}
                  </button>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: call.caller_phone === "Unknown" ? C.dim : C.text, fontStyle: call.caller_phone === "Unknown" ? "italic" : "normal", padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {call.caller_phone === "Unknown" ? "Unknown" : call.caller_phone}
                </span>
                <div style={{ padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sd.isUnknown ? <span style={{ fontSize: 12, color: C.dim }}>—</span>
                    : sd.isNew ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{sd.label}</span>
                        <span style={{ fontSize: 9, background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBdr}`, padding: "1px 5px", borderRadius: 8, fontWeight: 700, flexShrink: 0 }}>New</span>
                      </div>
                    ) : <span style={{ fontSize: 12, fontWeight: 500, color: C.textSub }}>{sd.label}</span>}
                </div>
                <div style={{ padding: "0 8px", display: "flex", alignItems: "center", gap: 5 }}>
                  {empClr && call.employee_name ? (
                    <>
                      <div style={{ width: 20, height: 20, borderRadius: 6, background: empClr.bg, border: `1px solid ${empClr.br}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: empClr.t }}>
                        {init(call.employee_name)}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: empClr.t }}>{call.employee_name.split(" ")[0]}</span>
                    </>
                  ) : <span style={{ fontSize: 12, color: C.dim }}>—</span>}
                </div>
                <div style={{ padding: "0 8px" }}>
                  {call.line_number ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: C.blueLight, border: `1px solid ${C.blueBdr}`, color: C.blue }}>
                      {call.line_number.replace(/^Line\s*/i, "")}
                    </span>
                  ) : <span style={{ color: C.dim, fontSize: 11 }}>—</span>}
                </div>
                <div style={{ padding: "0 8px" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
                    background: isIn ? C.greenLight : C.orangeLight,
                    color: isIn ? C.green : C.orange,
                    border: `1px solid ${isIn ? C.greenBdr : C.orangeBdr}`,
                  }}>{isIn ? "In" : "Out"}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.textSub, padding: "0 8px" }}>{fmtS(call.duration_secs)}</span>
                <div style={{ padding: "0 8px" }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.text }}>{dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.dim }}>{dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Line Status Grid */}
      {data?.line_status && data.line_status.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: C.text }}>Line Status</p>
          <p style={{ margin: "0 0 16px", fontSize: 12, color: C.muted }}>All {data.line_status.length} lines at a glance</p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {data.line_status.map((ls, i) => {
              const num     = String(i + 1).padStart(2, "0");
              const hasEmp  = !!ls.employee_name;
              const empName = ls.employee_name ?? null;

              // Find employee for color
              const matchUser = empName ? { color_index: i % 3 === 0 ? 1 : 2 } : null;
              const clr = matchUser ? eClr(matchUser.color_index) : null;

              return (
                <div key={ls.line} style={{
                  padding: "14px 16px",
                  background: C.bgDeep, border: `1px solid ${C.border}`,
                  borderRadius: 12, textAlign: "center",
                  opacity: hasEmp ? 1 : 0.55,
                }}>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: hasEmp ? C.orange : C.dim }}>
                    {num}
                  </p>
                  {hasEmp && clr ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 6 }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 5,
                        background: clr.bg, border: `1.5px solid ${clr.br}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 8, fontWeight: 800, color: clr.t,
                      }}>{init(empName!)}</div>
                      <span style={{ fontSize: 11, color: C.textSub, fontWeight: 600 }}>{empName!.split(" ")[0]}</span>
                    </div>
                  ) : (
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: C.dim }}>—</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
