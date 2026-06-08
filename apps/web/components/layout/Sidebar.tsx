"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { C, eClr, init } from "@/lib/colors";
import { fetcher } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import type { EmployeeName } from "@callflow/shared-types";

export default function Sidebar() {
  const router   = useRouter();
  const pathname = usePathname();
  const { name, role, color_index, isOwner } = useAuth();
  const { syncLabel, isLive } = useSystemStatus();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [empOpen, setEmpOpen]       = useState(true);
  const [hovNav, setHovNav]         = useState<string | null>(null);

  const { data: employees } = useSWR<EmployeeName[]>(
    isOwner ? "/employees/names" : null,
    fetcher
  );

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
  const activeEmps = employees ?? [];

  const SectionLabel = ({ label }: { label: string }) => (
    <p style={{
      margin: "16px 10px 8px",
      fontSize: 10, fontWeight: 800,
      color: C.dim, textTransform: "uppercase", letterSpacing: 1.4,
    }}>{label}</p>
  );

  const NavBtn = ({
    id, label, path, icon, exact = false, badge,
  }: {
    id: string; label: string; path: string; icon?: string; exact?: boolean; badge?: number;
  }) => {
    const active = isActive(path, exact);
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


            <SectionLabel label="Calls" />
            <NavBtn id="recordings" label="Recordings" path="/dashboard/recordings" icon="▷" />
            <NavBtn id="misc"       label="Misc Calls"  path="/dashboard/misc"       icon="◎" />

        {isOwner && (
          <>
            <SectionLabel label="Analytics" />
            <NavBtn id="overview" label="Dashboard" path="/dashboard/overview" icon="⊞" exact />

            {/* Employees with expandable sub-list */}
            <button
              onClick={() => { setEmpOpen(o => !o); nav("/dashboard/employees"); }}
              onMouseEnter={() => setHovNav("employees")}
              onMouseLeave={() => setHovNav(null)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "11px 14px", borderRadius: 12, border: "none",
                background: isActive("/dashboard/employees")
                  ? "linear-gradient(135deg,rgba(232,118,26,0.14),rgba(245,158,11,0.07))"
                  : hovNav === "employees" ? C.hover : "transparent",
                color: isActive("/dashboard/employees") ? C.orange : C.textSub,
                fontWeight: isActive("/dashboard/employees") ? 700 : 500,
                fontSize: 15, cursor: "pointer", marginBottom: 3, textAlign: "left",
                transition: "all 0.15s",
                boxShadow: isActive("/dashboard/employees") ? "inset 0 0 0 1px rgba(232,118,26,0.20)" : "none",
              }}
            >
              <span style={{ fontSize: 16, width: 22, textAlign: "center", flexShrink: 0, color: isActive("/dashboard/employees") ? C.orange : C.muted }}>◉</span>
              <span style={{ flex: 1, letterSpacing: -0.1 }}>Employees</span>
              <span style={{
                fontSize: 11, color: isActive("/dashboard/employees") ? C.orange : C.muted,
                transition: "transform 0.2s", display: "inline-block",
                transform: empOpen ? "rotate(90deg)" : "rotate(0deg)",
              }}>›</span>
            </button>

            {empOpen && (
              <div style={{ marginLeft: 16, marginBottom: 4, borderLeft: `2px solid ${C.borderLight}`, paddingLeft: 8 }}>
                {activeEmps.map((emp) => {
                  const path   = `/dashboard/employees/${emp.id}`;
                  const active = pathname.startsWith(path);
                  const clr    = eClr(emp.color_index);
                  return (
                    <button
                      key={emp.id}
                      onClick={() => nav(path)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 9,
                        padding: "9px 12px", borderRadius: 10, border: "none",
                        background: active ? C.orangeLight : "transparent",
                        cursor: "pointer", marginBottom: 2,
                        color: active ? C.orange : C.textSub,
                        transition: "all 0.12s",
                      }}
                    >
                      <div style={{
                        width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                        background: clr.bg, border: `1px solid ${clr.br}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, fontWeight: 800, color: clr.t,
                      }}>
                        {init(emp.name)}
                      </div>
                      <span style={{
                        fontSize: 14, fontWeight: active ? 700 : 500,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {emp.name.split(" ")[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}


        {isOwner && (
          <>
            <SectionLabel label="Management" />
            <NavBtn id="lines"     label="Lines"      path="/dashboard/lines"      icon="≡" />
            <NavBtn id="intercoms" label="Intercoms"  path="/dashboard/intercoms"  icon="☎" />
            <NavBtn id="team"      label="Team"       path="/dashboard/team"       icon="◯" />
            <NavBtn id="students"  label="Students"   path="/dashboard/students"   icon="◈" />
          </>
        )}
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
              {role === "owner" ? "Owner" : "Employee"}
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
