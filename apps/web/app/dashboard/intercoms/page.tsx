
"use client";

import { useState } from "react";
import useSWR from "swr";
import { C } from "@/lib/colors";
import { fetcher } from "@/lib/api";
import AssignIntercomModal from "@/components/modals/AssignIntercomModal";
import type { Intercom } from "@callflow/shared-types";

export default function IntercomsPage() {
  const { data: intercoms, isLoading } = useSWR<Intercom[]>("/intercoms", fetcher);
  const [editing, setEditing] = useState<Intercom | null>(null);

  const maxCalls = Math.max(...(intercoms ?? []).map(i => i.call_count_total), 1);
  const assigned = (intercoms ?? []).filter(i => i.phone_number).length;

  const IC_COLORS = [C.orange, C.teal, C.blue, C.green, C.red, "#7c3aed"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Intercom Assignment</h1>
          <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted }}>Manage phone number mapping for each intercom extension</p>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>
              {assigned}<span style={{ fontSize: 16, color: C.muted, fontWeight: 500 }}> / {(intercoms ?? []).length}</span>
            </p>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>intercoms assigned</p>
          </div>
          <div style={{ width: 52, height: 52, position: "relative" }}>
            <svg viewBox="0 0 52 52" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="26" cy="26" r="22" fill="none" stroke={C.bgDeep} strokeWidth="5"/>
              <circle cx="26" cy="26" r="22" fill="none" stroke={C.teal} strokeWidth="5"
                strokeDasharray={String(2 * Math.PI * 22)}
                strokeDashoffset={String(2 * Math.PI * 22 * (1 - assigned / Math.max((intercoms ?? []).length, 1)))}
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
          {/* Header */}
          <div style={{
            display: "grid", gridTemplateColumns: "80px 1fr 180px 100px",
            padding: "10px 20px",
            background: C.bgDeep, borderBottom: `1px solid ${C.border}`,
          }}>
            {["Intercom", "Phone Number", "Calls", "Action"].map((h) => (
              <span key={h} style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.9 }}>
                {h}
              </span>
            ))}
          </div>

          {(intercoms ?? []).map((ic, i) => {
            const isLast  = i === (intercoms ?? []).length - 1;
            const barPct  = ic.call_count_total / maxCalls;
            const icColor = IC_COLORS[i % IC_COLORS.length];
            const icNum   = `60${i + 1}`;

            return (
              <div
                key={ic.id}
                style={{
                  display: "grid", gridTemplateColumns: "80px 1fr 180px 100px",
                  alignItems: "center",
                  padding: "14px 20px",
                  borderBottom: isLast ? "none" : `1px solid ${C.borderLight}`,
                }}
              >
                {/* IC badge */}
                <div>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    padding: "4px 10px", borderRadius: 8,
                    background: ic.phone_number ? (icColor + "20") : C.bgDeep,
                    border: `1.5px solid ${ic.phone_number ? (icColor + "44") : C.border}`,
                    fontSize: 12, fontWeight: 800,
                    color: ic.phone_number ? icColor : C.dim,
                  }}>
                    {icNum}
                  </span>
                </div>

                {/* Phone */}
                <div style={{ fontSize: 13, color: ic.phone_number ? C.text : C.dim, fontStyle: ic.phone_number ? "normal" : "italic" }}>
                  {ic.phone_number ?? "Unassigned"}
                </div>

                {/* Calls bar */}
                <div style={{ paddingRight: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 4, background: C.bgDeep, borderRadius: 4 }}>
                      <div style={{
                        width: `${barPct * 100}%`, height: "100%",
                        background: ic.call_count_total > 0 ? C.orange : "transparent",
                        borderRadius: 4,
                      }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: ic.call_count_total > 0 ? C.orange : C.dim, minWidth: 14, textAlign: "right" }}>
                      {ic.call_count_total}
                    </span>
                  </div>
                </div>

                {/* Action */}
                <button
                  onClick={() => setEditing(ic)}
                  style={{
                    padding: "6px 14px",
                    border: `1px solid ${ic.phone_number ? C.border : C.orangeBdr}`,
                    borderRadius: 8,
                    background: ic.phone_number ? C.bgDeep : C.orangeLight,
                    color: ic.phone_number ? C.textSub : C.orange,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {ic.phone_number ? "Edit" : "Assign"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editing && <AssignIntercomModal intercom={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
