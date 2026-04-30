"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { C } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import type { EmployeeName, Line } from "@callflow/shared-types";

interface Props {
  line: Line;
  onClose: () => void;
}

export default function AssignLineModal({ line, onClose }: Props) {
  const { data: employees } = useSWR<EmployeeName[]>("/employees/names", fetcher);
  const [employeeId, setEmployeeId] = useState(line.employee_id ?? "");
  const [purpose,    setPurpose]    = useState(line.purpose ?? "");
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await api.patch(`/lines/${line.id}`, {
        employee_id: employeeId || null,
        purpose:     purpose.trim() || null,
      });
      await mutate("/lines");
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
        width: 420, background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 20, padding: "28px 32px",
        boxShadow: C.shadowMd,
        zIndex: 201,
      }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800, color: C.text }}>
          Assign Line
        </h3>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: C.muted }}>
          {line.line_number}
        </p>

        {/* Employee */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
            Employee
          </label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            style={{
              width: "100%", padding: "10px 12px",
              background: C.bgDeep, border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 13, color: C.text,
              outline: "none",
            }}
          >
            <option value="">Unassigned</option>
            {(employees ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>

        {/* Purpose */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
            Purpose (optional)
          </label>
          <input
            type="text"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Front desk, Studio 1"
            style={{
              width: "100%", padding: "10px 12px", boxSizing: "border-box",
              background: C.bgDeep, border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 13, color: C.text,
              outline: "none",
            }}
          />
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
              padding: "9px 20px", border: "none",
              borderRadius: 10,
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
