"use client";

import { useEffect, useMemo, useState, use } from "react";
import useSWR from "swr";
import { C, eClr, init, fmtS } from "@/lib/colors";
import { fetcher } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import CallTable from "@/components/calls/CallTable";
import CallPanel from "@/components/calls/CallPanel";
import BarChart from "@/components/ui/BarChart";
import PeriodSelect from "@/components/ui/PeriodSelect";
import { toBarChartData } from "@/lib/chartTransforms";
import { usePeriodRange } from "@/hooks/usePeriodRange";
import { activityPhrase, periodPhrase } from "@/lib/period";
import type { Employee, EmployeeAnalytics, Call, Paginated } from "@callflow/shared-types";

const PAGE_SIZE = 25;

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { id: myId, isOwner, isLoading: authLoading } = useAuth();
  const effectiveId = isOwner ? id : myId;

  const { period, range, params: rangeParams, selectProps } = usePeriodRange();
  const [page,           setPage]           = useState(1);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  // Page 3 of "All Time" is meaningless once the range narrows to a single day.
  useEffect(() => { setPage(1); }, [rangeParams, effectiveId]);

  const analyticsQuery = useMemo(() => {
    if (!effectiveId) return null;
    return `/analytics/employee/${effectiveId}${rangeParams ? `?${rangeParams}` : ""}`;
  }, [effectiveId, rangeParams]);

  const { data: employee } = useSWR<Employee>(effectiveId ? `/employees/${effectiveId}` : null, fetcher);
  const { data: analytics } = useSWR<EmployeeAnalytics>(analyticsQuery, fetcher);

  const callQuery = useMemo(() => {
    if (!effectiveId) return null;
    const p = new URLSearchParams();
    p.set("limit",       String(PAGE_SIZE));
    p.set("offset",      String((page - 1) * PAGE_SIZE));
    p.set("employee_id", effectiveId);
    p.set("is_misc",     "false");
    if (range.date_from) p.set("date_from", range.date_from);
    if (range.date_to) p.set("date_to", range.date_to);
    return `/calls?${p.toString()}`;
  }, [page, effectiveId, range]);

  const { data: callsData, isLoading } = useSWR<Paginated<Call>>(callQuery, fetcher, { keepPreviousData: true });

  if (authLoading || !effectiveId) {
    return <p style={{ color: C.muted, fontSize: 14 }}>Loading...</p>;
  }
  if (!employee) return <p style={{ color: C.muted, fontSize: 14 }}>Loading...</p>;

  const clr = eClr(employee.color_index);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 16, flexShrink: 0,
            background: clr.bg, border: `2px solid ${clr.br}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 800, color: clr.t,
          }}>
            {init(employee.name)}
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>
              {employee.name}
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: 14, color: C.muted }}>Agent Dashboard</p>
          </div>
        </div>

        <PeriodSelect {...selectProps} />
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {[
          { label: "Total Calls",  value: analytics?.total_calls ?? "—",                       sub: `Calls ${periodPhrase(period)}`, icon: "📞", accent: C.orange },
          { label: "Inbound",      value: analytics?.inbound ?? "—",                            sub: "Answered",          icon: "📥", accent: C.green },
          { label: "Outbound",     value: analytics?.outbound ?? "—",                           sub: "Dialed",            icon: "📤", accent: C.teal },
          { label: "Avg Duration", value: analytics ? fmtS(analytics.avg_duration_secs) : "—", sub: "Per call",          icon: "⏱", accent: C.blue },
        ].map((s) => (
          <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px", boxShadow: C.shadow }}>
            <p style={{ margin: "0 0 8px", fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>{s.label}</p>
            <p style={{ margin: 0, fontSize: 30, fontWeight: 700, color: s.accent, letterSpacing: -0.5, lineHeight: 1 }}>{s.value}</p>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: C.muted }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Daily breakdown */}
      {analytics && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "24px 28px", boxShadow: C.shadow }}>
          <div style={{ marginBottom: 20 }}>
            <p style={{ margin: "0 0 3px", fontSize: 15, fontWeight: 700, color: C.text }}>Activity Breakdown</p>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
              {activityPhrase(period)} for {employee.name.split(" ")[0]}
            </p>
          </div>
          <BarChart data={toBarChartData(analytics.daily_breakdown)} />
        </div>
      )}

      {/* Call history */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px", marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
            {employee.name.split(" ")[0]}&apos;s Call History
          </p>
          <span style={{ fontSize: 13, color: C.muted }}>{callsData?.total ?? "—"} calls</span>
        </div>

        {isLoading && !callsData ? (
          <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>
        ) : (
          <CallTable
            calls={callsData?.data ?? []}
            total={callsData?.total ?? 0}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onSelect={(call) => setSelectedCallId(id => id === call.id ? null : call.id)}
            selectedId={selectedCallId ?? undefined}
          />
        )}
      </div>

      <CallPanel callId={selectedCallId} onClose={() => setSelectedCallId(null)} />
    </div>
  );
}
