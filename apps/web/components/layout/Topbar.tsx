"use client";

import { usePathname } from "next/navigation";
import { C } from "@/lib/colors";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { Employee } from "@callflow/shared-types";

const PAGE_LABELS: Record<string, string> = {
  overview:   "Dashboard",
  recordings: "Recordings",
  misc:       "Misc Calls",
  lines:      "Lines",
  intercoms:  "Intercoms",
  team:       "Team",
  students:   "Students",
  employees:  "Employees",
};

export default function Topbar() {
  const pathname  = usePathname();
  const { isLive } = useSystemStatus();

  const segments = pathname.split("/").filter(Boolean); // ["dashboard", "overview"]
  const section  = segments[1] ?? "";
  const empId    = segments[1] === "employees" && segments[2] ? segments[2] : null;

  const { data: emp } = useSWR<Employee>(empId ? `/employees/${empId}` : null, fetcher);

  const pageLabel = empId
    ? (emp?.name ?? "Employee")
    : (PAGE_LABELS[section] ?? "Dashboard");

  const now = new Date();
  const monthYear = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <header style={{
      height: 52,
      background: C.card,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 24px",
      position: "sticky", top: 0, zIndex: 30,
    }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.muted }}>
        <span>Max Music School</span>
        <span style={{ color: C.dim }}>›</span>
        <span style={{ color: C.text, fontWeight: 600 }}>{pageLabel}</span>
      </div>

      {/* Right: date + LIVE */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12, color: C.muted }}>{monthYear}</span>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 12px",
          background: isLive ? C.greenLight : C.bgDeep,
          border: `1px solid ${isLive ? C.greenBdr : C.border}`,
          borderRadius: 20,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: isLive ? C.green : C.dim,
            display: "inline-block",
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: isLive ? C.green : C.muted }}>
            {isLive ? "LIVE" : "No Sync"}
          </span>
        </div>
      </div>
    </header>
  );
}
