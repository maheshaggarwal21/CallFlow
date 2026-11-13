"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { C, eClr, init } from "@/lib/colors";
import { useAuth } from "@/hooks/useAuth";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import { HOME, TABS, rankLabel } from "@/lib/tabs";

export default function Sidebar() {
  const router   = useRouter();
  const pathname = usePathname();
  const { name, role, color_index, isOwner, isUser, can } = useAuth();
  const { syncLabel, isLive } = useSystemStatus();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [hovNav, setHovNav]         = useState<string | null>(null);

  function nav(path: string) { router.push(path); }

  function isActive(path: string, exact = false) {
    return exact ? pathname === path : pathname.startsWith(path);
  }

  async function handleLogout() {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore network errors — still clear local state
    }
    router.push("/login");
  }

  const { t: myClrT, bg: myClrBg, br: myClrBr } = eClr(color_index);
  // only the tabs ticked for this user (Users → Tabs), grouped under their section labels
  const myTabs = TABS.filter((t) => can(t.key));
  const sections = [...new Set(myTabs.map((t) => t.section))];
  const showSalary = isOwner && process.env.NODE_ENV !== "production";

  const SectionLabel = ({ label }: { label: string }) => (
    <p style={{
      margin: "16px 10px 8px",
      fontSize: 10, fontWeight: 800,
      color: C.dim, textTransform: "uppercase", letterSpacing: 1.4,
    }}>{label}</p>
  );

  const NavBtn = ({
    id, label, path, icon, exact = false, badge, match,
  }: {
    id: string; label: string; path: string; icon?: string; exact?: boolean; badge?: number; match?: string;
  }) => {
    const active = isActive(match ?? path, exact);
    const hov    = hovNav === id;
    return (
      <button
        onClick={() => nav(path)}
        onMouseEnter={() => setHovNav(id)}
        onMouseLeave={() => setHovNav(null)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "11px 14px", borderRadius: 12, border: "none",
          background: active
            ? "linear-gradient(135deg,rgba(232,118,26,0.14),rgba(245,158,11,0.07))"
            : hov ? C.hover : "transparent",
          color: active ? C.orange : C.textSub,
          fontWeight: active ? 700 : 500,
          fontSize: 15, cursor: "pointer",
          marginBottom: 3, textAlign: "left",
          transition: "all 0.15s",
          boxShadow: active ? "inset 0 0 0 1px rgba(232,118,26,0.20)" : "none",
        }}
      >
        {icon && (
          <span style={{ fontSize: 16, width: 22, textAlign: "center", flexShrink: 0, color: active ? C.orange : C.muted }}>
            {icon}
          </span>
        )}
        <span style={{ flex: 1, letterSpacing: -0.1 }}>{label}</span>
        {badge !== undefined && badge > 0 && (
          <span style={{
            background: C.orangeLight, border: `1px solid ${C.orangeBdr}`,
            borderRadius: 10, padding: "2px 9px",
            fontSize: 12, color: C.orange, fontWeight: 700,
          }}>{badge}</span>
        )}
      </button>
    );
  };

  return (
    <aside style={{
      width: 240, minWidth: 240,
      height: "100vh",
      background: C.sidebar,
      borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      position: "sticky", top: 0,
      overflow: "hidden",
    }}>
      {/* Logo */}
      <div style={{ padding: "24px 20px 20px", borderBottom: `1px solid ${C.borderLight}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{
            width: 40, height: 40, flexShrink: 0,
            background: "linear-gradient(135deg,#e8761a,#f59e0b)",
            borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: "0 3px 10px rgba(232,118,26,0.32)",
          }}>♪</div>
          <div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>CallFlow</p>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, fontWeight: 500 }}>Max Music School</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 12px", overflowY: "auto" }}>


        {/* A User's own page: their details, targets and report */}
        {isUser && <NavBtn id="home" label="My Dashboard" path={HOME} icon="⌂" />}

        {/* sample screen, local only until the real page exists; it sits in the Salary section with Payments */}
        {[...sections, ...(showSalary && !sections.includes("Salary") ? ["Salary"] : [])].map((sec) => (
          <div key={sec}>
            <SectionLabel label={sec} />
            {sec === "Salary" && showSalary && <NavBtn id="salary" label="Employee Tracker" path="/dashboard/salary" icon="₹" />}
            {myTabs.filter((t) => t.section === sec).map((t) => (
              <NavBtn key={t.key} id={t.key} label={t.label} path={t.path} match={t.match} icon={t.icon} exact={t.exact} />
            ))}
          </div>
        ))}


      </nav>

      {/* Status indicators */}
      <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "9px 12px", borderRadius: 10,
          background: isLive ? C.greenLight : C.bgDeep,
          border: `1px solid ${isLive ? C.greenBdr : C.border}`,
        }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: isLive ? C.green : C.dim, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: isLive ? C.green : C.muted, fontWeight: 600 }}>
            {syncLabel}
          </span>
        </div>

      </div>

      {/* User + logout */}
      <div style={{ padding: "10px 14px 18px", borderTop: `1px solid ${C.borderLight}`, position: "relative" }}>
        <button
          onClick={() => setLogoutOpen(o => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 11,
            padding: "11px 12px", borderRadius: 11,
            border: `1px solid ${C.border}`,
            background: logoutOpen ? C.hover : C.bgDeep,
            cursor: "pointer", transition: "background 0.1s",
          }}
        >
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: myClrBg, border: `1.5px solid ${myClrBr}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800, color: myClrT,
          }}>
            {init(name)}
          </div>
          <div style={{ textAlign: "left", flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
              {rankLabel(role)}
            </p>
          </div>
        </button>

        {logoutOpen && (
          <>
            <div onClick={() => setLogoutOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
            <div style={{
              position: "absolute", bottom: "calc(100% + 4px)", left: 14, right: 14,
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 12, boxShadow: C.shadowMd, zIndex: 50, overflow: "hidden",
            }}>
              <button
                onClick={handleLogout}
                style={{
                  width: "100%", padding: "11px 16px",
                  border: "none", background: "transparent",
                  color: C.red, fontSize: 13, fontWeight: 600,
                  cursor: "pointer", textAlign: "left",
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                ← Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
