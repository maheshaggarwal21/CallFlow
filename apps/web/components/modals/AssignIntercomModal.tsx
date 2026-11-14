"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { C } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import type { EmployeeName, Intercom, Line } from "@callflow/shared-types";

interface Props {
  intercom: Intercom;
  onClose: () => void;
}

export default function AssignIntercomModal({ intercom, onClose }: Props) {
  const { data: lines } = useSWR<Line[]>("/lines", fetcher);
  const [phone,  setPhone]  = useState(intercom.phone_number ?? "");
  const { data: people } = useSWR<EmployeeName[]>("/employees/names", fetcher);
  const [line,   setLine]   = useState(intercom.line_number ?? "");
  const lineRow = (lines ?? []).find((l) => l.line_number === line);
  // the person field shows the picked line's owner until it is changed here
  const [agent,  setAgent]  = useState<string | null>(null);
  const agentId = agent ?? lineRow?.employee_id ?? "";
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await api.patch(`/intercoms/${intercom.id}`, {
        phone_number: phone.trim() || null,
        line_number: line || null,
      });
      // the line's owner gets every recording the line makes (this replaced the Lines tab, 14 Nov)
      if (lineRow && agentId !== (lineRow.employee_id ?? "")) {
        await api.patch(`/lines/${lineRow.id}`, { employee_id: agentId || null });
      }
      await Promise.all([mutate("/intercoms"), mutate("/lines")]);
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.18)", zIndex: 200 }}
      />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 380, background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 20, padding: "28px 32px",
        boxShadow: C.shadowMd,
        zIndex: 201,
      }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800, color: C.text }}>
          Intercom {intercom.intercom_code}
        </h3>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: C.muted }}>
          Its line, the person on that line, and its calling number
        </p>

        {/* The Users form reads this link: picking the line there fills this intercom and number, and the other way round */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
            Line
          </label>
          <select
            value={line}
            onChange={(e) => { setLine(e.target.value); setAgent(null); }}
            style={{
              width: "100%", padding: "10px 12px", boxSizing: "border-box",
              background: C.bgDeep, border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 13, color: C.text, outline: "none",
            }}
          >
            <option value="">— No line —</option>
            {(lines ?? []).map((l) => <option key={l.id} value={l.line_number}>{l.line_number}{l.employee_name ? ` · ${l.employee_name}` : ""}</option>)}
          </select>
        </div>

        {line && (
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
              Person on line {line}
            </label>
            <select
              value={agentId}
              onChange={(e) => setAgent(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", boxSizing: "border-box",
                background: C.bgDeep, border: `1px solid ${C.border}`,
                borderRadius: 10, fontSize: 13, color: C.text, outline: "none",
              }}
            >
              <option value="">— No one —</option>
              {/* a switched-off owner isn't in the active list: keep them, so saving doesn't silently take the line away */}
              {lineRow?.employee_id && !(people ?? []).some((p) => p.id === lineRow.employee_id) && (
                <option value={lineRow.employee_id}>{lineRow.employee_name} (switched off)</option>
              )}
              {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: C.muted }}>
              Every call this line records goes to this person.
            </p>
          </div>
        )}

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
            Phone Number
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            style={{
              width: "100%", padding: "10px 12px", boxSizing: "border-box",
              background: C.bgDeep, border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 13, color: C.text, outline: "none",
            }}
          />
          <p style={{ margin: "6px 0 0", fontSize: 11, color: C.muted }}>
            Leave blank to unassign.
          </p>
        </div>

        {error && (
          <p style={{ margin: "0 0 12px", fontSize: 13, color: C.red }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "9px 20px", border: `1px solid ${C.border}`,
              borderRadius: 10, background: C.bgDeep,
              color: C.textSub, fontWeight: 600, fontSize: 13, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "9px 20px", border: "none", borderRadius: 10,
              background: saving ? C.dim : C.orange,
              color: "#fff", fontWeight: 700, fontSize: 13,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
