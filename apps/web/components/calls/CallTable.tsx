"use client";

import { useState, useRef, useEffect } from "react";
import { C, eClr, init, fmtS } from "@/lib/colors";
import { getStudentDisplay } from "@/lib/studentLabel";
import { api } from "@/lib/api";
import Pagination from "@/components/ui/Pagination";
import { WAIconInline } from "@/components/ui/WABtn";
import MobileCallCard from "@/components/calls/MobileCallCard";
import type { Call } from "@callflow/shared-types";

const COLS = "44px 1fr 0.8fr 0.7fr 80px 108px 76px 64px 92px 44px 36px 36px";
const HDRS = ["", "Number", "Student", "Agent", "Line", "IC", "Type", "Dur", "Time", "Review", "", ""];
const CENTER = new Set([0, 4, 5, 6, 9, 10, 11]);

interface Props {
  calls: Call[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onSelect: (call: Call) => void;
  selectedId?: string;
}

export default function CallTable({ calls, total, page, pageSize, onPageChange, onSelect, selectedId }: Props) {
  const totalPages  = Math.ceil(total / pageSize);
  const [hovId, setHovId]         = useState<string | null>(null);
  const [playingId, setPlayingId]   = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const urlCache   = useRef<Map<string, string>>(new Map());
  const [isMobile, setIsMobile] = useState(false);

  // Stop audio when component unmounts or calls list changes
  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, [calls]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 820);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  async function handlePlay(call: Call) {
    // Pause if already playing this call
    if (playingId === call.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
    }

    // Use cached URL, inline URL, or fetch on-demand from /calls/:id
    let audioUrl: string | null =
      urlCache.current.get(call.id) ?? call.audio_presigned_url ?? null;

    if (!audioUrl) {
      setFetchingId(call.id);
      try {
        const data = await api.get<Call>(`/calls/${call.id}`);
        audioUrl = data.audio_presigned_url ?? null;
        if (audioUrl) urlCache.current.set(call.id, audioUrl);
      } catch {
        // silently ignore — no audio available
      } finally {
        setFetchingId(null);
      }
    }

    if (!audioUrl) return;

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.play().catch(() => {});
    setPlayingId(call.id);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
  }

  if (calls.length === 0) {
    return (
      <div style={{
        padding: "56px 24px", textAlign: "center",
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        color: C.muted, fontSize: 14,
      }}>
        No calls found.
      </div>
    );
  }

  if (isMobile) {
    return (
      <div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
          {calls.map((call, i) => (
            <MobileCallCard
              key={call.id}
              call={call}
              onMore={onSelect}
                            isLast={i === calls.length - 1}
            />
          ))}
        </div>

        {totalPages > 1 && (
          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
              {total.toLocaleString()} call{total !== 1 ? "s" : ""}
            </p>
            <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          display: "grid", gridTemplateColumns: COLS,
          alignItems: "center",
          padding: "0 20px", minHeight: 40,
          borderBottom: `2px solid ${C.border}`,
          background: C.bgDeep,
        }}>
          {HDRS.map((h, i) => (
            <span key={i} style={{
              fontSize: 10, fontWeight: 800, color: C.muted,
              textTransform: "uppercase", letterSpacing: 1.1, whiteSpace: "nowrap",
              padding: "0 6px",
              textAlign: CENTER.has(i) ? "center" : "left",
            }}>{h}</span>
          ))}
        </div>

        {/* Rows */}
        {calls.map((call) => {
          const sd       = getStudentDisplay(call.caller_phone, call.student_name);
          const empClr   = call.color_index !== null ? eClr(call.color_index) : null;
          const dt       = new Date(call.called_at);
          const isIn     = call.call_direction === "inbound";
          const isSel    = call.id === selectedId;
          const isHov    = hovId === call.id;
          const isPlaying  = playingId === call.id;
          const isFetching = fetchingId === call.id;

          return (
            <div
              key={call.id}
              style={{
                display: "grid", gridTemplateColumns: COLS,
                alignItems: "center",
                padding: "0 20px", minHeight: 52,
                borderBottom: `1px solid ${C.borderLight}`,
                background: isSel ? C.orangeLight : isHov ? C.hover : "transparent",
                transition: "background 0.12s",
                userSelect: "text",
              }}
              onMouseEnter={() => setHovId(call.id)}
              onMouseLeave={() => setHovId(null)}
            >
              {/* Play audio button */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>
                <button
                  onClick={() => handlePlay(call)}
                  title={isFetching ? "Loading…" : isPlaying ? "Pause" : "Play recording"}
                  style={{
                    width: 32, height: 32, borderRadius: "50%", border: "none",
                    background: isPlaying
                      ? `linear-gradient(135deg,${C.orange},#f59e0b)`
                      : C.bgDeep,
                    boxShadow: isPlaying
                      ? "0 2px 8px rgba(232,118,26,0.35)"
                      : `inset 0 0 0 1.5px ${C.border}`,
                    cursor: isFetching ? "wait" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: isPlaying ? 11 : 10,
                    color: isPlaying ? "#fff" : C.muted,
                    transition: "all 0.18s", flexShrink: 0,
                    opacity: isFetching ? 0.6 : 1,
                  }}
                >
                  {isFetching ? "⏳" : isPlaying ? "⏸" : "▶"}
                </button>
              </div>

              {/* Number */}
              <div style={{ minWidth: 0, padding: "0 6px" }}>
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  color: call.caller_phone === "Unknown" ? C.dim : C.text,
                  fontStyle: call.caller_phone === "Unknown" ? "italic" : "normal",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block",
                }}>
                  {call.caller_phone === "Unknown" ? "Unknown" : call.caller_phone}
                </span>
              </div>

              {/* Student */}
              <div style={{ minWidth: 0, padding: "0 6px" }}>
                {sd.isUnknown ? (
                  <span style={{ fontSize: 12, color: C.dim, fontStyle: "italic" }}>—</span>
                ) : sd.isNew ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sd.label}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: C.orange, background: C.orangeLight, border: `1px solid ${C.orangeBdr}`, padding: "1px 5px", borderRadius: 10, flexShrink: 0 }}>New</span>
                  </div>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 500, color: C.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{sd.label}</span>
                )}
              </div>

              {/* Agent */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, padding: "0 6px" }}>
                {empClr && call.employee_name ? (
                  <>
                    <div style={{
                      width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                      background: empClr.bg, border: `1px solid ${empClr.br}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 800, color: empClr.t,
                    }}>{init(call.employee_name)}</div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: empClr.t, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {call.employee_name.split(" ")[0]}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: C.dim }}>—</span>
                )}
              </div>

              {/* Line */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>
                {call.line_number ? (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: C.blue,
                    background: C.blueLight, border: `1px solid ${C.blueBdr}`,
                    borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap",
                  }}>
                    {call.line_number.replace(/^Line\s*/i, "")}
                  </span>
                ) : <span style={{ fontSize: 12, color: C.dim }}>—</span>}
              </div>

              {/* IC */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>
                {call.intercom_code ? (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: C.teal,
                    background: C.tealLight, border: `1px solid ${C.tealBdr}`,
                    borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap",
                  }}>
                    {call.intercom_code.replace(/^IC-/i, "")}
                  </span>
                ) : <span style={{ fontSize: 12, color: C.dim }}>—</span>}
              </div>

              {/* Type */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: isIn ? C.green : C.orange,
                  background: isIn ? C.greenLight : C.orangeLight,
                  border: `1px solid ${isIn ? C.greenBdr : C.orangeBdr}`,
                  borderRadius: 20, padding: "3px 10px",
                }}>
                  {isIn ? "In" : "Out"}
                </span>
              </div>

              {/* Duration */}
              <div style={{ padding: "0 6px" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.textSub }}>{fmtS(call.duration_secs)}</span>
              </div>

              {/* Time */}
              <div style={{ padding: "0 6px" }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>
                  {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </p>
                <p style={{ margin: 0, fontSize: 10, color: C.dim, lineHeight: 1.3 }}>
                  {dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                </p>
              </div>

              {/* WhatsApp */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <WAIconInline phone={call.caller_phone} />
              </div>

              {/* Detail panel button (›) */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <button
                  onClick={() => onSelect(call)}
                  title="View details"
                  style={{
                    width: 28, height: 28, borderRadius: 8, border: `1px solid ${isSel ? C.orange : C.border}`,
                    background: isSel ? C.orange : "transparent", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, fontWeight: 700, color: isSel ? "#fff" : C.muted, transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSel) {
                      e.currentTarget.style.background = C.orange;
                      e.currentTarget.style.color = "#fff";
                      e.currentTarget.style.borderColor = C.orange;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSel) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = C.muted;
                      e.currentTarget.style.borderColor = C.border;
                    }
                  }}
                >›</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
            {total.toLocaleString()} call{total !== 1 ? "s" : ""}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </div>
      )}
    </div>
  );
}
