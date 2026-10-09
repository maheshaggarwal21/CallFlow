"use client";

import { useMemo, useState, useRef } from "react";
import useSWR from "swr";
import { C, eClr, init, fmtS } from "@/lib/colors";
import { fetcher, api } from "@/lib/api";
import { playbackCandidates, playWithFallback } from "@/lib/audioPlayback";
import { getStudentDisplay } from "@/lib/studentLabel";
import { fmtTime, fmtDate } from "@/lib/datetime";
import { activityPhrase, periodPhrase } from "@/lib/period";
import { usePeriodRange } from "@/hooks/usePeriodRange";
import { toLineChartData } from "@/lib/chartTransforms";
import type { Call } from "@callflow/shared-types";
import PieChart from "@/components/ui/PieChart";
import LineChart from "@/components/ui/LineChart";
import PeriodSelect from "@/components/ui/PeriodSelect";
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
          {delta != null ? `${delta >= 0 ? "+" : ""}${delta}% vs previous period` : sub}
        </p>
      )}
    </div>
  );
}

export default function OverviewPage() {
  const { period, params, selectProps } = usePeriodRange();
  const [playingId, setPlayingId]           = useState<string | null>(null);
  const [fetchingId, setFetchingId]         = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCache = useRef<Map<string, { urls: string[]; at: number }>>(new Map());

  async function handlePlay(call: Call) {
    if (playingId === call.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
    }
    // Links are signed for 15 min, so reuse them for 10 at most
    const cached = urlCache.current.get(call.id);
    let urls: string[] = cached && Date.now() - cached.at < 10 * 60_000 ? cached.urls : [];
    if (urls.length === 0) {
      setFetchingId(call.id);
      try {
        const data = await api.get<Call>(`/calls/${call.id}`);
        urls = playbackCandidates(data);
        if (urls.length) urlCache.current.set(call.id, { urls, at: Date.now() });
      } catch {
        // no audio
      } finally {
        setFetchingId(null);
      }
    }
    // Opus by default, MP3 if this browser can't play it (see lib/audioPlayback)
    const audio = playWithFallback(urls, () => setPlayingId(null));
    if (!audio) return;
    audioRef.current = audio;
    setPlayingId(call.id);
  }

  const query = useMemo(
    () => `/analytics/overview${params ? `?${params}` : ""}`,
    [params]
  );

  const { data } = useSWR<OverviewStats>(query, fetcher);

  const inPct  = data?.direction_split.inbound_pct  ?? 0;
  const outPct = data?.direction_split.outbound_pct ?? 0;
  const phrase = periodPhrase(period);

  // Unattributed calls are part of `total_calls` (the donut centre), so they get
  // their own segment — otherwise the agent bars never add up to the total.
  const splitRows = useMemo(() => {
    const rows = (data?.team_split ?? []).map((e) => ({
      key: e.employee_id,
      name: e.name,
      count: e.count,
      pct: e.pct,
      color: eClr(e.color_index).t,
      chip: eClr(e.color_index),
    }));
    if (data && data.unassigned_count > 0) {
      rows.push({
        key: "unassigned",
        name: "Unassigned",
        count: data.unassigned_count,
        pct: data.unassigned_pct,
        color: C.dim,
        chip: { t: C.muted, bg: C.bgDeep, br: C.border },
      });
    }
    return rows;
  }, [data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* Header + month picker */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Dashboard</h1>
          <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted, fontWeight: 400 }}>Overview · Max Music School</p>
        </div>
        <PeriodSelect {...selectProps} />
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <StatCard label="Total Calls"  value={data?.total_calls ?? "—"} icon="📞" accent={C.orange} delta={data?.mom_delta.total_pct ?? null} sub={`calls ${phrase}`} />
        <StatCard label="Inbound"      value={data?.inbound ?? "—"}     icon="📥" accent={C.green}  delta={data?.mom_delta.inbound_pct ?? null} />
        <StatCard label="Outbound"     value={data?.outbound ?? "—"}    icon="📤" accent={C.teal}   delta={data?.mom_delta.outbound_pct ?? null} />
        <StatCard label="Avg Duration" value={data ? fmtS(data.avg_duration_secs) : "—"} icon="⏱" accent={C.blue} sub="average call length" />
      </div>

      {/* Direction Split + Team Split */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Call Direction Split */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: C.text }}>Call Direction Split</p>
          <p style={{ margin: "0 0 18px", fontSize: 12, color: C.muted }}>Inbound vs outbound {phrase}</p>
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
          <p style={{ margin: "0 0 18px", fontSize: 12, color: C.muted }}>Calls handled per agent {phrase}</p>
          {splitRows.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <PieChart
                segments={splitRows.map((e) => ({ value: e.count, color: e.color + "cc" }))}
                size={120}
                innerRadius={0.62}
                label={String(data?.total_calls ?? 0)}
                sublabel="total"
              />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                {splitRows.map((entry) => (
                  <div key={entry.key}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: 6,
                          background: entry.chip.bg, border: `1.5px solid ${entry.chip.br}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 8, fontWeight: 800, color: entry.chip.t,
                        }}>{entry.key === "unassigned" ? "—" : init(entry.name)}</div>
                        <span style={{ fontSize: 12, color: C.textSub }}>{entry.name.split(" ")[0]}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{entry.count}</span>
                    </div>
                    <div style={{ height: 4, background: C.bgDeep, borderRadius: 4 }}>
                      <div style={{ width: `${entry.pct}%`, height: "100%", background: entry.color + "bb", borderRadius: 4, transition: "width 0.4s" }} />
                    </div>
                  </div>
                ))}

                {data?.team_split[0] && (
                  <div style={{
                    marginTop: 4, padding: "8px 10px",
                    background: C.orangeLight, border: `1px solid ${C.orangeBdr}`, borderRadius: 8,
                  }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: C.orange, textTransform: "uppercase", letterSpacing: 0.6 }}>KEY INSIGHT</p>
                    <p style={{ margin: "3px 0 0", fontSize: 11, color: C.textSub }}>
                      {data.team_split[0].name.split(" ")[0]} leads with {data.team_split[0].count} calls {phrase}
                    </p>
                    {data.top_line && (
                      <p style={{ margin: "1px 0 0", fontSize: 11, color: C.textSub }}>
                        {data.top_line.line_number} is the highest traffic line {phrase}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : <p style={{ color: C.muted, fontSize: 13 }}>No data</p>}
        </div>
      </div>

      {/* Activity chart */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Activity</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>{activityPhrase(period)}</p>
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
          {data ? (
            <LineChart data={toLineChartData(data.weekly_activity)} showLegend={false} />
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Loading…</p>
          )}
        </div>
      </div>
      {/* Team Breakdown Grid */}
      {data?.team_split && data.team_split.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", boxShadow: C.shadow }}>
          <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: C.text }}>Team Breakdown</p>
          <p style={{ margin: "0 0 16px", fontSize: 12, color: C.muted }}>Calls handled per agent {phrase}</p>

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
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.text }}>{fmtTime(dt)}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{fmtDate(dt)}</p>
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
