"use client";

import { usePathname } from "next/navigation";
import { C } from "@/lib/colors";
import { useSystemStatus } from "@/hooks/useSystemStatus";

const PAGE_LABELS: Record<string, string> = {
  recordings: "Recordings",
  reports:    "Reports",
  intercoms:  "Intercoms",
  users:      "Users",
  teams:      "Teams",
  me:         "My Dashboard",
  payments:   "Payments",
  "working-days": "Working Days",
  salary:     "Salary",
  "crm/":         "Leads",
  "crm/settings": "Codes",
};

export default function Topbar({ onMenu }: { onMenu?: () => void }) {
  const pathname  = usePathname();
  const { isLive } = useSystemStatus();

  const segments = pathname.split("/").filter(Boolean); // ["dashboard", "overview"]
  const section  = segments[1] === "crm" ? `crm/${segments[2] ?? ""}` : segments[1] ?? "";
  const pageLabel = PAGE_LABELS[section] ?? "Dashboard";

  const now = new Date();
  const monthYear = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <header className="cf-top" style={{
      height: 52,
      background: C.card,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 24px", gap: 10,
      position: "sticky", top: 0, zIndex: 30,
    }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.muted, minWidth: 0 }}>
        {/* phone only: opens the menu */}
        <button type="button" className="cf-menu" onClick={onMenu} aria-label="Open menu"
          style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 10, width: 38, height: 34, fontSize: 18, color: C.text, cursor: "pointer", marginRight: 4 }}>☰</button>
        <span className="cf-wide">Max Music School</span>
        <span className="cf-wide" style={{ color: C.dim }}>›</span>
        <span style={{ color: C.text, fontWeight: 600 }}>{pageLabel}</span>
      </div>

      {/* Right: date + LIVE */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="cf-wide" style={{ fontSize: 12, color: C.muted }}>{monthYear}</span>
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
