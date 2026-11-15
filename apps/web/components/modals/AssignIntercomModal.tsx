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
  const { data: intercoms } = useSWR<Intercom[]>("/intercoms", fetcher);
  const [line,   setLine]   = useState(intercom.line_number ?? "");
  const lineRow = (lines ?? []).find((l) => l.line_number === line);
  // One intercom per line and one line per person (client, 15 Nov 2026): the Line list offers only lines no other
  // intercom is on, and the Agent list only active people who don't hold another line (plus this line's own agent).
  const lineOptions = (lines ?? []).filter((l) => !(intercoms ?? []).some((i) => i.id !== intercom.id && i.line_number === l.line_number));
  const holds = new Map((lines ?? []).filter((l) => l.employee_id).map((l) => [l.employee_id as string, l.line_number]));
  const agentOptions = (people ?? []).filter((p) => !holds.has(p.id) || holds.get(p.id) === line);
  // calls that came in on a free line count for nobody; they can be given to the line's agent
  const gap = lineRow?.gap_calls ?? 0;
  const [claim, setClaim] = useState(true);
  // Line and Agent are two separate choices (client, 15 Nov 2026): picking a line does not pick its person.
  // "" = leave the line's person as it is; "none" = free the line; else the person it goes to. It starts on the
  // current person of this intercom's line so nothing looks blank, and goes back to "leave as is" when the line changes.
  const [agent,  setAgent]  = useState(() => (lines ?? []).find((l) => l.line_number === (intercom.line_number ?? ""))?.employee_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  async function handleSave() {
    if (agent !== "" && !lineRow) return setError("Pick a line to put that person on.");
    setSaving(true);
    setError("");
    try {
      // the line's person gets every recording the line makes (this replaced the Lines tab, 14 Nov); done first, so a
      // refusal ("already has line 03", "switched off") leaves the intercom as it was
      const to = agent === "none" ? null : agent !== "" ? agent : (lineRow?.employee_id ?? null);
      const giveCalls = claim && gap > 0 && !!to;
      if (lineRow && ((agent !== "" && to !== lineRow.employee_id) || giveCalls)) {
        await api.patch(`/lines/${lineRow.id}`, { employee_id: to, ...(giveCalls ? { claim_gap: true } : {}) });
      }
      await api.patch(`/intercoms/${intercom.id}`, {
        phone_number: phone.trim() || null,
        line_number: line || null,
      });
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
            onChange={(e) => { setLine(e.target.value); setAgent(""); }}
            style={{
              width: "100%", padding: "10px 12px", boxSizing: "border-box",
              background: C.bgDeep, border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 13, color: C.text, outline: "none",
            }}
          >
            <option value="">— No line —</option>
            {lineOptions.map((l) => <option key={l.id} value={l.line_number}>{l.line_number}</option>)}
          </select>
        </div>

        {(
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
              Agent
            </label>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", boxSizing: "border-box",
                background: C.bgDeep, border: `1px solid ${C.border}`,
                borderRadius: 10, fontSize: 13, color: C.text, outline: "none",
              }}
            >
              <option value="">— Leave as it is —</option>
              <option value="none">No one (free the line)</option>
              {/* a switched-off person isn't in the active list: keep them, so the picker can still show who is on the line */}
              {lineRow?.employee_id && !(people ?? []).some((p) => p.id === lineRow.employee_id) && (
                <option value={lineRow.employee_id}>{lineRow.employee_name} (switched off)</option>
              )}
              {agentOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: C.muted }}>
              {lineRow ? (lineRow.employee_name ? `Line ${line} is with ${lineRow.employee_name} now. ` : `Line ${line} has no one now. `) : ""}
              Every call the line records goes to its agent.
            </p>
            {gap > 0 && lineRow && (agent !== "none") && (agent !== "" || lineRow.employee_id) && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "10px 12px", background: C.orangeLight, border: `1px solid ${C.orangeBdr}`, borderRadius: 10, fontSize: 12.5, color: C.text, cursor: "pointer" }}>
                <input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} style={{ marginTop: 2, accentColor: C.orange }} />
                <span>Also give them the <b>{gap} call{gap === 1 ? "" : "s"}</b> that came in on line {line} with no agent{lineRow.freed_at ? ` since ${new Date(lineRow.freed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}. Until then they count for nobody.</span>
              </label>
            )}
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
