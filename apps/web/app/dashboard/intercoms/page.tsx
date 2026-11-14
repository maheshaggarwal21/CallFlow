"use client";

// Intercoms tab (client, 14 Nov 2026: the Lines tab was folded in here). Each intercom has a calling
// number and sits on one PBX line; the person on that line owns every recording that line makes.
import { useState } from "react";
import useSWR from "swr";
import { C } from "@/lib/colors";
import { fetcher } from "@/lib/api";
import AssignIntercomModal from "@/components/modals/AssignIntercomModal";
import type { Intercom, Line } from "@callflow/shared-types";

const COLS = "90px minmax(130px,1fr) 80px minmax(160px,1.3fr) minmax(130px,1fr) 90px";

export default function IntercomsPage() {
  const { data: intercoms, isLoading } = useSWR<Intercom[]>("/intercoms", fetcher);
  const { data: lines } = useSWR<Line[]>("/lines", fetcher);
  const [editing, setEditing] = useState<Intercom | null>(null);

  const lineOf = (no: string | null) => (lines ?? []).find((l) => l.line_number === no);
  const maxCalls = Math.max(...(lines ?? []).map((l) => l.call_count_today), 1);
  const linked = (intercoms ?? []).filter((i) => i.line_number).length;
  // lines that make calls but have no intercom yet: shown so no one's line disappears from view
  const bare = (lines ?? []).filter((l) => l.employee_id && !(intercoms ?? []).some((i) => i.line_number === l.line_number));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Intercoms</h1>
          <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted }}>Each intercom&apos;s calling number, its line, and the person whose calls that line records</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>
            {linked}<span style={{ fontSize: 16, color: C.muted, fontWeight: 500 }}> / {(intercoms ?? []).length}</span>
          </p>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>on a line</p>
        </div>
      </div>

      {isLoading ? <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p> : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "12px 20px", background: C.bgDeep, borderBottom: `1px solid ${C.border}` }}>
              {["Intercom", "Calling Number", "Line", "Person", "Calls Today", ""].map((h, i) => (
                <span key={i} style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.9 }}>{h}</span>
              ))}
            </div>
            {(intercoms ?? []).map((ic, i) => {
              const line = lineOf(ic.line_number);
              const calls = line?.call_count_today ?? 0;
              return (
                <div key={ic.id} style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, alignItems: "center", padding: "14px 20px",
                  borderBottom: i === (intercoms ?? []).length - 1 ? "none" : `1px solid ${C.borderLight}` }}>
                  <span style={{ justifySelf: "start", padding: "4px 10px", borderRadius: 8, fontSize: 12, fontWeight: 800,
                    background: line ? C.orangeLight : C.bgDeep, border: `1.5px solid ${line ? C.orangeBdr : C.border}`, color: line ? C.orange : C.dim }}>
                    {ic.intercom_code}</span>
                  <span style={{ fontSize: 14, color: ic.phone_number ? C.text : C.dim }}>{ic.phone_number ?? "—"}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: line ? C.text : C.dim }}>{ic.line_number ?? "—"}</span>
                  <span style={{ minWidth: 0 }}>
                    {line?.employee_name
                      ? <><span style={{ display: "block", fontSize: 14, fontWeight: 700, color: C.text }}>{line.employee_name}</span>
                          {line.employee_code != null && <span style={{ fontSize: 12, color: C.muted }}>Reg No. {line.employee_code}</span>}</>
                      : <span style={{ fontSize: 14, color: C.dim }}>{line ? "No one" : "—"}</span>}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, height: 4, background: C.bgDeep, borderRadius: 4 }}>
                      <span style={{ display: "block", width: `${(calls / maxCalls) * 100}%`, height: "100%", background: C.orange, borderRadius: 4 }} />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: calls ? C.orange : C.dim, minWidth: 24, textAlign: "right" }}>{line ? calls : "—"}</span>
                  </span>
                  <button type="button" onClick={() => setEditing(ic)} style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: `1px solid ${line ? C.border : C.orangeBdr}`, background: line ? C.bgDeep : C.orangeLight, color: line ? C.textSub : C.orange,
                  }}>{line ? "Edit" : "Assign"}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bare.length > 0 && (
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
          Lines with a person but no intercom yet: {bare.map((l) => `${l.line_number} · ${l.employee_name}`).join(", ")}. Their calls are still recorded; press Assign on an intercom to put it on one.</p>
      )}

      {editing && <AssignIntercomModal intercom={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
