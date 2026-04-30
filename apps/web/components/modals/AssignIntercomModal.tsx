"use client";

import { useState } from "react";
import { mutate } from "swr";
import { C } from "@/lib/colors";
import { api } from "@/lib/api";
import type { Intercom } from "@callflow/shared-types";

interface Props {
  intercom: Intercom;
  onClose: () => void;
}

export default function AssignIntercomModal({ intercom, onClose }: Props) {
  const [phone,  setPhone]  = useState(intercom.phone_number ?? "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await api.patch(`/intercoms/${intercom.id}`, {
        phone_number: phone.trim() || null,
      });
      await mutate("/intercoms");
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
          Assign Intercom
        </h3>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: C.muted }}>
          Code: <strong>{intercom.intercom_code}</strong>
        </p>

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
