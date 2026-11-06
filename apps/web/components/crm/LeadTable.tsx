"use client";

// Lead rows shared by the queue sections, the queue's "All leads" tab and the All Leads page.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Call } from "@callflow/shared-types";
import { R, dur } from "@/components/report/kit";
import { api } from "@/lib/api";
import { playWithFallback, playbackCandidates } from "@/lib/audioPlayback";
import { STATUS_LABEL, fmtAgo, fmtWhen, groupPhone, type LeadRow } from "@/lib/crm";
import { CodeChip, Tag, tdStyle, thStyle } from "./kit";

/** One inline player for the whole table: play a lead's last recording, click again to stop. */
export function useInlinePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = async (callId: string) => {
    audio.current?.pause();
    if (playing === callId) return setPlaying(null);
    setPlaying(callId);
    try {
      const urls = await api.get<Pick<Call, "audio_urls" | "audio_format" | "audio_presigned_url">>(`/crm/calls/${callId}/audio`);
      audio.current = playWithFallback(playbackCandidates(urls as Call), () => setPlaying(null));
      if (!audio.current) setPlaying(null);
    } catch {
      setPlaying(null);
    }
  };
  return { playing, toggle };
}

export type SortState = { sort: string; dir: "asc" | "desc" };

export default function LeadTable({ rows, onOpen, player, now, meId, sort, onSort, empty = "No leads here" }: {
  rows: LeadRow[]; onOpen: (id: string) => void; player: ReturnType<typeof useInlinePlayer>; now: number; meId: string;
  sort?: SortState; onSort?: (s: SortState) => void; empty?: string;
}) {
  if (!rows.length) return <p style={{ margin: "6px 2px 0", color: R.mute, fontSize: 13 }}>{empty}</p>;
  const head = (label: string, key?: string, style?: CSSProperties) => {
    const on = sort && key && sort.sort === key;
    const click = key && onSort ? () => onSort({ sort: key, dir: on && sort!.dir === "desc" ? "asc" : "desc" }) : undefined;
    return (
      <th key={label} style={{ ...thStyle, ...style, cursor: click ? "pointer" : "default" }} onClick={click}
        aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
        {label}{on ? (sort!.dir === "asc" ? " ↑" : " ↓") : ""}
      </th>
    );
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, tableLayout: "fixed", minWidth: 1000 }}>
        {/* Fixed widths so every queue section lines up */}
        <colgroup>{[21, 11, 14, 11, 5, 11, 17, 10].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
        <thead><tr>
          {head("Lead", "lead_code")}{head("Number")}{head("Source")}{head("Code", "status")}{head("Tries", "attempts")}
          {head("Last contacted", "last_contacted_at")}{head("Next follow-up", "next_followup_at")}{head("Last call")}
        </tr></thead>
        <tbody>
          {rows.map((l) => {
            const due = l.bucket === "due_now";
            return (
              <tr key={l.id} className={`crm-row${due ? " crm-due" : ""}`} tabIndex={0} style={{ cursor: "pointer" }}
                onClick={() => onOpen(l.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(l.id)}>
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <b>{l.name || "Unnamed"}</b>
                    {due && <span className="crm-due-pill"><Tag tone="gold">Due now</Tag></span>}
                    {l.tags?.includes("re-enquired") && <Tag tone="gold">re-enquired</Tag>}
                    {l.locked_by_name && l.locked_by !== meId && <Tag title={`${l.locked_by_name} has this lead open`}>🔒 {l.locked_by_name.split(" ")[0]}</Tag>}
                  </div>
                  <div style={{ fontSize: 11.5, color: R.mute }}>{l.lead_code} · {fmtAgo(l.created_at, now)}</div>
                </td>
                <td style={{ ...tdStyle, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", letterSpacing: ".02em" }}>{groupPhone(l.phone10)}</td>
                <td style={{ ...tdStyle, fontSize: 12.5, color: R.mute, maxWidth: 170 }}>{l.campaign ?? l.source ?? "—"}</td>
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}><CodeChip code={l.current_code} /><span style={{ fontSize: 12, color: R.mute }}>{STATUS_LABEL[l.status]}</span></div>
                </td>
                <td style={{ ...tdStyle, textAlign: "center" }}>{l.attempts}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtAgo(l.last_contacted_at, now)}</td>
                <td style={{ ...tdStyle, fontSize: 12.5, minWidth: 170 }}>
                  {l.next_followup_at ? <b style={{ color: l.bucket === "overdue" ? R.bad : due ? "#8a5a12" : R.ink }}>{fmtWhen(l.next_followup_at)}</b> : "—"}
                  {l.status === "callback" && l.callback_set_by_name && (
                    <div style={{ color: R.mute, fontSize: 11.5 }}>
                      Callback set by {l.callback_set_by_name.split(" ")[0]}{l.student_set_time ? ` · student asked for ${fmtWhen(l.next_followup_at).replace(/^Today /, "")}` : ""}
                    </div>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                  {l.last_call ? (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <button disabled={!l.last_call.has_audio} onClick={() => player.toggle(l.last_call!.id)} className="crm-btn"
                        aria-label={player.playing === l.last_call.id ? "Stop" : "Play last call"}
                        title={l.last_call.has_audio ? "Play the last recording" : "Audio expired (90-day limit)"}
                        style={{ width: 28, height: 28, borderRadius: 14, border: `1px solid ${R.line}`, background: player.playing === l.last_call.id ? R.out : R.card,
                          color: player.playing === l.last_call.id ? "#fff" : R.ink, cursor: l.last_call.has_audio ? "pointer" : "default", opacity: l.last_call.has_audio ? 1 : 0.4 }}>
                        {player.playing === l.last_call.id ? "■" : "▶"}</button>
                      <span style={{ fontSize: 12.5 }}>{dur(l.last_call.duration_secs)}</span>
                    </span>
                  ) : <span style={{ color: "#c2b39c", fontSize: 12 }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
