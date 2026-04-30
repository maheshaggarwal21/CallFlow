"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { C, eClr, init, fmtS } from "@/lib/colors";
import { fetcher } from "@/lib/api";
import CallTable from "@/components/calls/CallTable";
import CallPanel from "@/components/calls/CallPanel";
import StatCard from "@/components/ui/StatCard";
import { toBarChartData } from "@/lib/chartTransforms";
import BarChart from "@/components/ui/BarChart";
import EmployeeFilterDropdown from "@/components/employees/EmployeeFilterDropdown";
import type { Employee, EmployeeAnalytics, Call, Paginated } from "@callflow/shared-types";

const PAGE_SIZE = 25;

export default function EmployeesPage() {
  const { data: employees } = useSWR<Employee[]>("/employees", fetcher);
  const [activeId, setActiveId] = useState<string>("all");
  const [callType, setCallType] = useState<"all" | "inbound" | "outbound">("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeEmployees = (employees ?? []).filter((e) => e.status === "active");
  const activeEmployee = activeEmployees.find((e) => e.id === activeId) ?? null;

  const { data: analytics } = useSWR<EmployeeAnalytics>(
    activeId !== "all" ? `/analytics/employee/${activeId}` : null,
    fetcher
  );

  const callQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String((page - 1) * PAGE_SIZE));
    p.set("is_misc", "false");
    if (callType !== "all") p.set("direction", callType);
    if (activeId !== "all") p.set("employee_id", activeId);
    return `/calls?${p.toString()}`;
  }, [page, activeId, callType]);

  const { data: callsData, isLoading } = useSWR<Paginated<Call>>(callQuery, fetcher, { keepPreviousData: true });

  const handleSelect = useCallback((call: Call) => {
    setSelectedId((id) => (id === call.id ? null : call.id));
  }, []);

  const handleSetActive = useCallback((id: string) => {
    setActiveId(id);
    setPage(1);
    setSelectedId(null);
  }, []);

  const handleSetCallType = useCallback((type: "all" | "inbound" | "outbound") => {
    setCallType(type);
    setPage(1);
    setSelectedId(null);
  }, []);

  const handleClearFilters = useCallback(() => {
    setActiveId("all");
    setCallType("all");
    setPage(1);
    setSelectedId(null);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Employees</h1>
          <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted }}>Team performance and individual analytics</p>
        </div>
        {activeId !== "all" && (
          <button
            onClick={handleClearFilters}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: C.muted,
              fontSize: 14,
              fontWeight: 500,
              padding: 0,
            }}
          >
            <- All employees
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 2 }}>
        <button
          onClick={() => handleSetActive("all")}
          style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "16px 20px", borderRadius: 16,
            border: `1px solid ${C.border}`,
            background: activeId === "all" ? C.orangeLight : C.card,
            cursor: "pointer", flexShrink: 0,
            boxShadow: C.shadow, transition: "all 0.15s",
            minWidth: 180,
          }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: "rgba(100,95,90,0.10)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, fontWeight: 800, color: C.muted,
          }}>A</div>
          <div style={{ textAlign: "left" }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>All Agents</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>
              {callsData ? `${callsData.total} total calls` : "-"}
            </p>
          </div>
        </button>

        {activeEmployees.map((emp) => {
          const clr = eClr(emp.color_index);
          const selected = activeId === emp.id;
          return (
            <button
              key={emp.id}
              onClick={() => handleSetActive(emp.id)}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "16px 20px", borderRadius: 16,
                border: `1px solid ${selected ? clr.br : C.border}`,
                background: selected ? clr.bg : C.card,
                cursor: "pointer", flexShrink: 0,
                boxShadow: C.shadow, transition: "all 0.15s",
                minWidth: 200,
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: clr.bg, border: `1px solid ${clr.br}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, fontWeight: 800, color: clr.t,
              }}>
                {init(emp.name)}
              </div>
              <div style={{ textAlign: "left", minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>
                  {emp.name.split(" ")[0]}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>
                  {emp.call_stats ? `${emp.call_stats.total} calls` : "View analytics"}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {activeId !== "all" && activeEmployee && analytics && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <StatCard label="Total Calls" value={analytics.total_calls} sub="In selected range" accent={C.orange} />
            <StatCard label="Inbound" value={analytics.inbound} sub="Answered" accent={C.green} />
            <StatCard label="Outbound" value={analytics.outbound} sub="Dialed" accent={C.teal} />
            <StatCard label="Avg Duration" value={fmtS(analytics.avg_duration_secs)} sub="Per call" accent={C.blue} />
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "24px 28px", boxShadow: C.shadow }}>
            <div style={{ marginBottom: 20 }}>
              <p style={{ margin: "0 0 3px", fontSize: 15, fontWeight: 700, color: C.text }}>Daily Breakdown</p>
              <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
                Weekly call distribution for {activeEmployee.name.split(" ")[0]}
              </p>
            </div>
            <BarChart data={toBarChartData(analytics.daily_breakdown)} />
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <EmployeeFilterDropdown
          employees={activeEmployees.map((emp) => ({ id: emp.id, name: emp.name, color_index: emp.color_index }))}
          employeeId={activeId}
          callType={callType}
          onEmployeeChange={handleSetActive}
          onCallTypeChange={handleSetCallType}
          onClear={handleClearFilters}
        />
        <span style={{ fontSize: 13, color: C.muted }}>
          {callsData ? `${callsData.total} call${callsData.total !== 1 ? "s" : ""}` : "-"}
        </span>
      </div>

      {isLoading && !callsData ? (
        <div style={{ padding: 48, textAlign: "center", color: C.muted, fontSize: 14 }}>
          Loading...
        </div>
      ) : (
        <CallTable
          calls={callsData?.data ?? []}
          total={callsData?.total ?? 0}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onSelect={handleSelect}
          selectedId={selectedId ?? undefined}
        />
      )}

      <CallPanel callId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
