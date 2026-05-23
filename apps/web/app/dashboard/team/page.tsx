"use client";

import React, { useState } from "react";
import useSWR, { mutate } from "swr";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require("react-qr-code").default as React.FC<{ value: string; size?: number; fgColor?: string }>;
import { C, eClr, init, fmtS } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import EmployeeModal from "@/components/modals/EmployeeModal";
import type { Employee, Line } from "@callflow/shared-types";

export default function TeamPage() {
  const { data: employees, isLoading } = useSWR<Employee[]>("/employees", fetcher);
  const { data: lines } = useSWR<Line[]>("/lines", fetcher);
  const [modal,    setModal]    = useState<"add" | Employee | null>(null);
  const [apiKeyModal, setApiKeyModal] = useState<{ employee: Employee; apiKey: string } | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const active   = (employees ?? []).filter(e => e.status === "active").length;
  const inactive = (employees ?? []).filter(e => e.status === "inactive").length;
  const total    = (employees ?? []).length;

  async function toggleStatus(emp: Employee, e: React.MouseEvent) {
    e.stopPropagation();
    setToggling(emp.id);
    try {
      await api.patch(`/employees/${emp.id}`, {
        status: emp.status === "active" ? "inactive" : "active",
      });
      await mutate("/employees");
    } finally {
      setToggling(null);
    }
  }

  async function handleGenerateApiKey(emp: Employee, e: React.MouseEvent) {
    e.stopPropagation();
    setApiKeyError("");
    setApiKeyLoading(emp.id);
    try {
      const res = await api.post<{ api_key: string }>(`/employees/${emp.id}/api-key`);
      setApiKeyModal({ employee: emp, apiKey: res.api_key });
    } catch (err: any) {
      setApiKeyError(err.message ?? "Failed to generate API key.");
    } finally {
      setApiKeyLoading(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Team</h1>
          <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted }}>{active} active agent{active !== 1 ? "s" : ""} · Max Music School</p>
        </div>
        <button
          onClick={() => setModal("add")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 20px", background: C.orange, border: "none",
            borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 14,
            cursor: "pointer", boxShadow: "0 4px 14px rgba(232,118,26,0.32)",
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add Agent
        </button>
      </div>

      {apiKeyError && (
        <p style={{ margin: "-8px 0 0", fontSize: 13, color: C.red }}>
          {apiKeyError}
        </p>
      )}

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[
          { label: "Total Agents", value: total,    color: C.text },
          { label: "Active",       value: active,   color: C.green },
          { label: "Inactive",     value: inactive, color: C.muted },
        ].map((s) => (
          <div key={s.label} style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 14, padding: "18px 22px", boxShadow: C.shadow,
          }}>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>{s.label}</p>
            <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: s.color, letterSpacing: -0.5 }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Agent roster */}
      {isLoading ? (
        <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
          {(employees ?? []).map((emp, i) => {
            const isActive   = emp.status === "active";
            const ec         = isActive ? eClr(emp.color_index) : { t: C.muted, bg: "rgba(100,95,90,0.08)", br: C.border };
            const empLines   = (lines ?? []).filter(l => l.employee_id === emp.id);
            const isExpanded = expanded === emp.id;
            const isLast     = i === (employees ?? []).length - 1;
            const stats      = emp.call_stats;

            return (
              <div
                key={emp.id}
                style={{
                  borderBottom: isLast ? "none" : `1px solid ${C.borderLight}`,
                  opacity: isActive ? 1 : 0.55,
                  transition: "opacity 0.2s",
                }}
              >
                {/* Main row — clickable to expand */}
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 18,
                    padding: "20px 28px", cursor: "pointer",
                  }}
                  onClick={() => setExpanded(isExpanded ? null : emp.id)}
                >
                  {/* Avatar */}
                  <div style={{
                    width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                    background: ec.bg, border: `1px solid ${ec.br}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, fontWeight: 800, color: ec.t,
                  }}>
                    {init(emp.name)}
                  </div>

                  {/* Col: Name + phone — fixed width */}
                  <div style={{ width: 180, flexShrink: 0 }}>
                    <p style={{ margin: "0 0 3px", fontSize: 16, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emp.name}</p>
                    <p style={{ margin: 0, fontSize: 13, color: C.muted }}>{emp.phone ?? "No phone on file"}</p>
                  </div>

                  {/* Col: Active/Inactive — fixed width */}
                  <div style={{ width: 90, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
                      background: isActive ? C.greenLight : "rgba(100,95,90,0.08)",
                      color: isActive ? C.green : C.muted,
                      border: `1px solid ${isActive ? C.greenBdr : C.border}`,
                      textTransform: "uppercase", letterSpacing: 0.6,
                    }}>
                      {isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  {/* Col: Role — centered flex fill */}
                  <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                      background: emp.role === "owner" ? C.orangeLight : C.bgDeep,
                      color: emp.role === "owner" ? C.orange : C.muted,
                      border: `1px solid ${emp.role === "owner" ? C.orangeBdr : C.border}`,
                      textTransform: "uppercase", letterSpacing: 0.6,
                    }}>
                      {emp.role === "owner" ? "Owner" : "Employee"}
                    </span>
                  </div>

                  {/* Quick stats */}
                  <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
                    {[
                      { label: "Calls", value: stats ? stats.total : "—",  color: C.text },
                      { label: "In",    value: stats ? stats.inbound : "—", color: C.orange },
                      { label: "Out",   value: stats ? stats.outbound : "—", color: C.green },
                      { label: "Avg",   value: stats ? fmtS(stats.avg_duration_secs) : "—", color: C.blue },
                    ].map((stat) => (
                      <div key={stat.label} style={{ textAlign: "center" }}>
                        <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: stat.color }}>{stat.value}</p>
                        <p style={{ margin: 0, fontSize: 11, color: C.muted, textTransform: "uppercase", fontWeight: 600, letterSpacing: 0.5 }}>{stat.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Chevron */}
                  <span style={{
                    fontSize: 13, color: C.dim, marginLeft: 8,
                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.2s", display: "inline-block",
                  }}>›</span>
                </div>

                {/* Expanded section */}
                {isExpanded && (
                  <div style={{ padding: "0 28px 24px", background: C.bgDeep, borderTop: `1px solid ${C.borderLight}` }}>
                    <div style={{ paddingTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                      {/* Assigned Lines */}
                      <div>
                        <p style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>Assigned Lines</p>
                        {empLines.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 14, color: C.dim }}>No lines assigned</p>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {empLines.map((ln) => (
                              <div key={ln.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                                <span style={{ fontSize: 13, fontWeight: 800, color: C.blue, background: C.blueLight, border: `1px solid ${C.blueBdr}`, borderRadius: 7, padding: "2px 10px" }}>
                                  {ln.line_number}
                                </span>
                                {ln.purpose && <span style={{ fontSize: 13, color: C.muted, fontStyle: "italic" }}>"{ln.purpose}"</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "flex-start" }}>
                        <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>Actions</p>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setModal(emp); }}
                            style={{
                              padding: "9px 16px", borderRadius: 10, cursor: "pointer",
                              border: `1px solid ${C.border}`, background: C.card,
                              color: C.textSub, fontSize: 13, fontWeight: 600,
                            }}
                          >Edit</button>
                          <button
                            onClick={(e) => handleGenerateApiKey(emp, e)}
                            title="Generate API key"
                            disabled={apiKeyLoading === emp.id}
                            style={{
                              padding: "9px 16px", borderRadius: 10, cursor: "pointer",
                              border: `1px solid ${C.border}`, background: C.card,
                              color: C.textSub, fontSize: 13, fontWeight: 600,
                              display: "flex", alignItems: "center", gap: 6,
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M3 3h7v7H3V3zm2 2v3h3V5H5zm8-2h7v7h-7V3zm2 2v3h3V5h-3zM3 13h7v7H3v-7zm2 2v3h3v-3H5zm11-1h2v2h-2v-2zm-3 0h2v2h-2v-2zm3 3h2v2h-2v-2zm-5 0h2v2h-2v-2zm2 2h2v2h-2v-2zm-2 2h2v2h-2v-2zm3-2h2v2h-2v-2z"/>
                            </svg>
                            {apiKeyLoading === emp.id ? "Generating..." : "API Key"}
                          </button>
                          <button
                            onClick={(e) => toggleStatus(emp, e)}
                            disabled={toggling === emp.id}
                            style={{
                              padding: "9px 16px", borderRadius: 10, cursor: "pointer",
                              border: `1px solid ${isActive ? C.redBdr : C.greenBdr}`,
                              background: isActive ? C.redLight : C.greenLight,
                              color: isActive ? C.red : C.green,
                              fontSize: 13, fontWeight: 700,
                            }}
                          >
                            {toggling === emp.id ? "…" : isActive ? "Deactivate agent" : "Reactivate agent"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit modal */}
      {modal && (
        <EmployeeModal
          employee={modal === "add" ? undefined : modal}
          onClose={() => setModal(null)}
        />
      )}

      {/* API key modal */}
      {apiKeyModal && (
        <>
          <div onClick={() => setApiKeyModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,15,10,0.35)", backdropFilter: "blur(6px)", zIndex: 200 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 22, padding: "32px 36px",
            boxShadow: "0 24px 72px rgba(0,0,0,0.14)", zIndex: 201, textAlign: "center",
            maxWidth: 420,
          }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 19, fontWeight: 700, color: C.text }}>Employee API Key</h3>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: C.muted }}>
              {apiKeyModal.employee.name} — shown once, copy now
            </p>
            <div style={{ padding: 16, background: "#fff", borderRadius: 12, display: "inline-block", border: `1px solid ${C.border}` }}>
              <QRCode value={`api_key=${apiKeyModal.apiKey}`} size={180} fgColor={C.text} />
            </div>
            <div style={{ marginTop: 16, padding: "10px 12px", background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <p style={{ margin: 0, fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 700 }}>API Key</p>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: C.text, wordBreak: "break-all" }}>{apiKeyModal.apiKey}</p>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard?.writeText(apiKeyModal.apiKey);
                  } catch {}
                }}
                style={{
                  padding: "8px 18px",
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  background: C.card,
                  color: C.textSub,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >Copy</button>
              <button
                onClick={() => setApiKeyModal(null)}
                style={{
                  padding: "8px 18px",
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  background: C.bgDeep,
                  color: C.textSub,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >Close</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
