"use client";

import { useState, useEffect } from "react";
import useSWR, { mutate } from "swr";
import { C, fmtL } from "@/lib/colors";
import { callSentiment } from "@/lib/callSentiment";
import { aiStatusTag } from "@/lib/tagMaps";
import { getStudentDisplay } from "@/lib/studentLabel";
import AudioPlayer from "@/components/ui/AudioPlayer";
import WABtn from "@/components/ui/WABtn";
import { api, fetcher } from "@/lib/api";
import Tag from "@/components/ui/Tag";
import type { Call } from "@callflow/shared-types";

interface Props {
  callId: string | null;
  onClose: () => void;
}

type Tab = "summary" | "transcript" | "details";

export default function CallPanel({ callId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const [resolving, setResolving] = useState(false);
  const { data: call, isLoading } = useSWR<Call>(
    callId ? `/calls/${callId}` : null,
    fetcher
  );

  useEffect(() => { setTab("summary"); }, [callId]);

  if (!callId) return null;

  const isIn   = call?.call_direction === "inbound";
  const sent   = call ? callSentiment(call) : null;
  const aiTag  = call ? aiStatusTag(call.ai_status) : null;

  const dt     = call ? new Date(call.called_at) : null;
  const sd     = call ? getStudentDisplay(call.caller_phone, call.student_name) : null;

  async function updateResolution(status: "resolved" | "escalated" | null) {
    if (!call) return;
    setResolving(true);
    try {
      await api.patch(`/calls/${call.id}/resolution`, { resolution_status: status });
      await mutate(`/calls/${call.id}`);
    } finally {
      setResolving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(20,15,10,0.18)", backdropFilter: "blur(2px)",
          zIndex: 190,
        }}
      />

      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0,
        width: 420, height: "100vh",
        background: C.card,
        borderLeft: `1px solid ${C.border}`,
        zIndex: 200,
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.10)",
        overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{
          padding: "22px 24px",
          borderBottom: `1px solid ${C.borderLight}`,
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 14,
              background: isIn ? C.greenLight : C.orangeLight,
              border: `1px solid ${isIn ? C.greenBdr : C.orangeBdr}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, flexShrink: 0,
            }}>
              {isIn ? "📲" : "📤"}
            </div>
            <div>
              <p style={{ margin: "0 0 3px", fontSize: 17, fontWeight: 700, color: C.text }}>
                {!call ? "Loading…" : call.caller_phone === "Unknown" ? "Unknown Number" : call.caller_phone}
              </p>
              {call && dt && (
                <p style={{ margin: 0, fontSize: 12, color: C.muted, fontWeight: 500 }}>
                  {dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  {" · "}
                  {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  {call.line_number ? ` · ${call.line_number}` : ""}
                  {call.intercom_code ? ` · ${call.intercom_code}` : ""}
                  {call.intercom_phone_number ? ` · ${call.intercom_phone_number}` : ""}
                  {call.employee_name ? ` · ${call.employee_name}` : ""}
                  {call.source_label ? ` · ${call.source_label}` : ""}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 9,
              color: C.muted, cursor: "pointer", padding: "6px 12px",
              fontSize: 13, fontWeight: 600, flexShrink: 0, marginTop: 2,
            }}
          >✕</button>
        </div>

        {/* Tabs */}
        <div style={{
          padding: "12px 24px",
          borderBottom: `1px solid ${C.borderLight}`,
          display: "flex", gap: 4, flexShrink: 0,
        }}>
          {(["summary", "transcript", "details"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "6px 14px", borderRadius: 8, border: "none",
                background: tab === t ? C.orange : "transparent",
                color: tab === t ? "#fff" : C.muted,
                cursor: "pointer", fontSize: 13, fontWeight: 600,
                textTransform: "capitalize", transition: "all 0.15s",
              }}
            >{t}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          {isLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ height: 42, background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 10 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={`stat-skel-${i}`}
                    style={{ height: 54, background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 10 }}
                  />
                ))}
              </div>
              <div style={{ height: 140, background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 12 }} />
              <div style={{ height: 120, background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 12 }} />
            </div>
          )}

          {!isLoading && call && (
            <>
              {/* ── SUMMARY TAB ── */}
              {tab === "summary" && (
                <>
                  <AudioPlayer url={call.audio_presigned_url ?? null} />

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    {aiTag && (
                      <Tag
                        label={aiTag.label}
                        color={aiTag.color}
                        bg={aiTag.bg}
                      />
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => updateResolution("resolved")}
                        disabled={resolving}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 9,
                          border: `1px solid ${C.greenBdr}`,
                          background: C.greenLight,
                          color: C.green,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: resolving ? "not-allowed" : "pointer",
                        }}
                      >Resolved</button>
                      <button
                        onClick={() => updateResolution("escalated")}
                        disabled={resolving}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 9,
                          border: `1px solid ${C.redBdr}`,
                          background: C.redLight,
                          color: C.red,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: resolving ? "not-allowed" : "pointer",
                        }}
                      >Escalated</button>
                      {call.resolution_status && (
                        <button
                          onClick={() => updateResolution(null)}
                          disabled={resolving}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 9,
                            border: `1px solid ${C.border}`,
                            background: C.bgDeep,
                            color: C.muted,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: resolving ? "not-allowed" : "pointer",
                          }}
                        >Clear</button>
                      )}
                    </div>
                  </div>

                  {/* Mini stat boxes */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[
                      ["Duration", fmtL(call.duration_secs), C.blue],
                      ["Direction", isIn ? "Inbound" : "Outbound", isIn ? C.green : C.orange],
                      ["Line", call.line_number ?? "—", C.blue],
                    ].map(([label, val, color]) => (
                      <div key={label as string} style={{
                        background: C.bgDeep, border: `1px solid ${C.border}`,
                        borderRadius: 10, padding: "12px 8px", textAlign: "center",
                      }}>
                        <p style={{ margin: "0 0 4px", fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</p>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: color as string }}>{val}</p>
                      </div>
                    ))}
                  </div>

                  {/* AI Summary */}
                  <div style={{ background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 14 }}>✦</span>
                      <p style={{ margin: 0, fontSize: 13, color: C.orange, fontWeight: 700, letterSpacing: 0.2 }}>AI Summary</p>
                    </div>
                    {call.ai_status !== "done" ? (
                      <p style={{ margin: 0, color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
                        Processing — check back in a few minutes.
                      </p>
                    ) : (
                      <p style={{ margin: 0, color: C.textSub, fontSize: 14, lineHeight: 1.75 }}>
                        {call.summary || "No summary available."}
                      </p>
                    )}
                    {sent && call.ai_status === "done" && (
                      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                        {!sd?.isUnknown && <WABtn phone={call.caller_phone} size="sm" />}
                        <span style={{ fontSize: 13, color: sent.color, fontWeight: 600 }}>
                          {sent.e} {sent.label}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ── TRANSCRIPT TAB ── */}
              {tab === "transcript" && (
                call.ai_status !== "done" ? (
                  <div style={{ textAlign: "center", padding: "48px 0" }}>
                    <p style={{ color: C.muted, fontSize: 14 }}>Transcript not available yet.</p>
                  </div>
                ) : call.transcript_json && call.transcript_json.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <p style={{ margin: 0, fontSize: 13, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>
                      Call Transcript
                    </p>
                    {call.transcript_json.map((turn, i) => {
                      const isAgent = turn.speaker === "Agent";
                      return (
                        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isAgent ? "flex-end" : "flex-start" }}>
                          <div style={{
                            maxWidth: "82%",
                            background: isAgent ? C.orangeLight : C.bgDeep,
                            border: `1px solid ${isAgent ? C.orangeBdr : C.border}`,
                            borderRadius: isAgent ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                            padding: "10px 14px",
                          }}>
                            <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: isAgent ? C.orange : C.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
                              {isAgent ? "AGENT" : "CALLER"}
                            </p>
                            <p style={{ margin: 0, fontSize: 14, color: C.text, lineHeight: 1.65 }}>{turn.text}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "48px 0" }}>
                    <p style={{ color: C.muted, fontSize: 14 }}>No transcript available.</p>
                  </div>
                )
              )}

              {/* ── DETAILS TAB ── */}
              {tab === "details" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {([
                    ["Phone",     call.caller_phone === "Unknown" ? "Unknown" : call.caller_phone],
                    ["Student",   sd?.isUnknown ? "—" : (sd?.label ?? "—")],
                    ["Date",      dt?.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) ?? "—"],
                    ["Time",      dt?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) ?? "—"],
                    ["Line",      call.line_number ?? "—"],
                    ["Intercom",  call.intercom_code ?? "—"],
                    ["Intercom Phone", call.intercom_phone_number ?? "—"],
                    ["Agent",     call.employee_name ?? "Unassigned"],
                    ["Direction", isIn ? "Inbound" : "Outbound"],
                    ["Duration",  fmtL(call.duration_secs)],
                    ["Source",    call.source_label ?? "—"],
                    ["AI Status", aiTag?.label ?? "Pending"],
                    ...(call.resolution_status ? [["Resolution", call.resolution_status === "resolved" ? "Resolved" : "Escalated"]] : []),
                  ] as [string, string][]).map(([label, val]) => (
                    <div key={label} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "13px 16px",
                      background: C.bgDeep, borderRadius: 10, border: `1px solid ${C.borderLight}`,
                    }}>
                      <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>{label}</span>
                      <span style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{val}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
