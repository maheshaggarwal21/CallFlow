"use client";

import { useState } from "react";
import useSWR from "swr";
import { C, eClr, init } from "@/lib/colors";
import { fetcher } from "@/lib/api";
import AssignLineModal from "@/components/modals/AssignLineModal";
import type { Line } from "@callflow/shared-types";

export default function LinesPage() {
  const { data: lines, isLoading } = useSWR<Line[]>("/lines", fetcher);
  const [editing, setEditing] = useState<Line | null>(null);

  const maxCalls = Math.max(...(lines ?? []).map(l => l.call_count_today), 1);
  const assigned = (lines ?? []).filter(l => l.employee_id).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Line Assignment</h1>
          <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted }}>Manage which agent handles each phone line</p>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>
              {assigned}<span style={{ fontSize: 16, color: C.muted, fontWeight: 500 }}> / {(lines ?? []).length}</span>
            </p>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>lines assigned</p>
          </div>
          <div style={{ width: 52, height: 52, position: "relative" }}>
            <svg viewBox="0 0 52 52" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="26" cy="26" r="22" fill="none" stroke={C.bgDeep} strokeWidth="5"/>
              <circle cx="26" cy="26" r="22" fill="none" stroke={C.orange} strokeWidth="5"
                strokeDasharray={String(2 * Math.PI * 22)}
                strokeDashoffset={String(2 * Math.PI * 22 * (1 - assigned / Math.max((lines ?? []).length, 1)))}
                strokeLinecap="round"/>
            </svg>
          </div>
        </div>
      </div>

      {isLoading ? (
        <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>
      ) : (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 16, overflow: "hidden",
        }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "72px 1fr 1fr 1fr 120px",
            padding: "12px 28px",
            background: C.bgDeep, borderBottom: `1px solid ${C.border}`,
          }}>
            {["Line", "Agent", "Purpose", "Calls Today", "Action"].map((h) => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                {h}
              </span>
            ))}
          </div>

          {(lines ?? []).map((line, i) => {
            const empClr  = line.employee_color_index !== null ? eClr(line.employee_color_index) : null;
            const barPct  = line.call_count_today / maxCalls;
            const isLast  = i === (lines ?? []).length - 1;
            const lineNum = String(i + 1).padStart(2, "0");

            return (
              <div
                key={line.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "72px 1fr 1fr 1fr 120px",
                  alignItems: "center",
                  padding: "18px 28px",
                  borderBottom: isLast ? "none" : `1px solid ${C.borderLight}`,
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {/* Line number badge */}
                <div>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: line.employee_id ? C.blueLight : C.bgDeep,
                    border: `1px solid ${line.employee_id ? C.blueBdr : C.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 800,
                    color: line.employee_id ? C.blue : C.dim,
                  }}>
                    {lineNum}
                  </div>
                </div>

                {/* Agent */}
                <div>
                  {empClr && line.employee_name ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 9,
                        background: empClr.bg, border: `1px solid ${empClr.br}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 700, color: empClr.t, flexShrink: 0,
                      }}>{init(line.employee_name)}</div>
                      <div>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{line.employee_name}</p>
                        <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{line.line_number}</p>
                      </div>
                    </div>
                  ) : (
                    <span style={{ fontSize: 14, color: C.dim, fontStyle: "italic" }}>Unassigned</span>
                  )}
                </div>

                {/* Purpose */}
                <div style={{ fontSize: 13, color: C.textSub }}>
                  {line.purpose ? `"${line.purpose}"` : <span style={{ color: C.dim }}>—</span>}
                </div>

                {/* Calls today — bar graph */}
                <div style={{ paddingRight: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 4, background: C.bgDeep, borderRadius: 4 }}>
                      <div style={{
                        width: `${barPct * 100}%`, height: "100%",
                        background: line.call_count_today > 0 ? C.orange : "transparent",
                        borderRadius: 4,
                      }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: line.call_count_today > 0 ? C.orange : C.dim, minWidth: 14, textAlign: "right" }}>
                      {line.call_count_today}
                    </span>
                  </div>
                </div>

                {/* Action */}
                <div>
                  <button
                    onClick={() => setEditing(line)}
                    style={{
                      padding: "7px 16px",
                      border: `1px solid ${line.employee_id ? C.border : C.orangeBdr}`,
                      borderRadius: 9,
                      background: line.employee_id ? C.bgDeep : C.orangeLight,
                      color: line.employee_id ? C.muted : C.orange,
                      fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    {line.employee_id ? "Reassign" : "Assign"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <AssignLineModal line={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
