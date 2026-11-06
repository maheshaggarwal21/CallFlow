"use client";

// Lead rows shared by the queue sections, the queue's "All leads" tab and the All Leads page.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Call } from "@callflow/shared-types";
import { R, dur } from "@/components/report/kit";
import { api } from "@/lib/api";
import { playWithFallback, playbackCandidates } from "@/lib/audioPlayback";
import { STATUS_LABEL, fmtAgo, fmtWhen, groupPhone, type LeadRow } from "@/lib/crm";
import { WhatsAppIcon } from "@/components/ui/WABtn";
import { CodeChip, Tag, tdStyle, thStyle } from "./kit";
import { Icon } from "./icons";

/** Google Calendar "add event" link for the follow-up (15 min slot). */
const gcalUrl = (l: LeadRow) => {
  const t = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const start = new Date(l.next_followup_at!).getTime();
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: "TEMPLATE", text: `Follow up: ${l.name || "Lead"} (${l.lead_code})`,
    dates: `${t(start)}/${t(start + 15 * 60_000)}`, details: `Call ${groupPhone(l.phone10)} via KoreCall`,
  })}`;
};

const actBtn: CSSProperties = { width: 28, height: 28, borderRadius: 8, border: `1px solid ${R.line}`, background: R.card, color: R.ink,
  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, textDecoration: "none" };

function Actions({ l, onOpen }: { l: LeadRow; onOpen: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(l.phone10).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  return (
    <span style={{ display: "inline-flex", gap: 5 }}>
      <button className="crm-btn" style={actBtn} onClick={() => onOpen(l.id)} title="Open lead form" aria-label={`Open ${l.name}`}><Icon name="open" size={15} /></button>
      <a className="crm-btn" style={{ ...actBtn, color: "#1fa855" }} href={`https://wa.me/91${l.phone10}`} target="_blank" rel="noopener noreferrer"
        title="Chat on WhatsApp" aria-label={`WhatsApp ${l.name}`}><WhatsAppIcon size={15} /></a>
      <button className="crm-btn" style={{ ...actBtn, color: copied ? R.good : R.ink }} onClick={copy}
        title={copied ? "Copied" : "Copy number (to dial on KoreCall)"} aria-label={`Copy number of ${l.name}`}><Icon name={copied ? "check" : "copy"} size={15} /></button>
      {l.next_followup_at
        ? <a className="crm-btn" style={actBtn} href={gcalUrl(l)} target="_blank" rel="noopener noreferrer"
            title={`Add follow-up (${fmtWhen(l.next_followup_at)}) to Google Calendar`} aria-label={`Add ${l.name}'s follow-up to calendar`}><Icon name="calendar" size={15} /></a>
        : <span style={{ ...actBtn, opacity: 0.35, cursor: "default" }} title="No follow-up scheduled"><Icon name="calendar" size={15} /></span>}
    </span>
  );
}

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

export default function LeadTable({ rows, onOpen, player, now, meId, sort, onSort, empty = "No leads here", selected, onSelect }: {
  rows: LeadRow[]; onOpen: (id: string) => void; player: ReturnType<typeof useInlinePlayer>; now: number; meId: string;
  /** Checkbox column (All Leads → assign) */
  selected?: Set<string>; onSelect?: (ids: string[], on: boolean) => void;
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, tableLayout: "fixed", minWidth: 1060 }}>
        {/* Fixed widths so every queue section lines up */}
        <colgroup>{(selected ? [3, 15, 10, 10, 11, 4, 10, 13, 9, 15] : [16, 10, 11, 11, 4, 10, 14, 9, 15]).map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
        <thead><tr>
          {selected && onSelect && (
            <th style={thStyle}><input type="checkbox" aria-label="Select all on this page" checked={rows.every((r) => selected.has(r.id))}
              onChange={(e) => onSelect(rows.map((r) => r.id), e.target.checked)} style={{ width: 16, height: 16, accentColor: R.out }} /></th>
          )}
          {head("Lead", "lead_code")}{head("Number")}{head("Source")}{head("Code", "status")}{head("Tries", "attempts")}
          {head("Last contacted", "last_contacted_at")}{head("Next follow-up", "next_followup_at")}{head("Last call")}{head("Actions")}
        </tr></thead>
        <tbody>
          {rows.map((l) => {
            const due = l.bucket === "due_now";
            return (
              <tr key={l.id} className={`crm-row${due ? " crm-due" : ""}`} tabIndex={0} style={{ cursor: "pointer", ...(selected?.has(l.id) ? { background: "#fff4e3" } : {}) }}
                onClick={() => onOpen(l.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(l.id)}>
                {selected && onSelect && (
                  <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={(e) => onSelect([l.id], e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: R.out }} />
                  </td>
                )}
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <b>{l.name || "Unnamed"}</b>
                    {due && <span className="crm-due-pill"><Tag tone="gold">Due now</Tag></span>}
                    {l.tags?.includes("re-enquired") && <Tag tone="gold">re-enquired</Tag>}
                    {l.assigned_to === meId ? <Tag tone="gold" title="Assigned to you">★ Mine</Tag>
                      : l.assigned_to_name ? <Tag title={`Assigned to ${l.assigned_to_name}`}>→ {l.assigned_to_name.split(" ")[0]}</Tag> : null}
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
                      Callback set by {l.callback_set_by_name.split(" ")[0]}
                      {l.assigned_to_name && l.assigned_to_name !== l.callback_set_by_name ? ` · for ${l.assigned_to_name.split(" ")[0]}` : ""}
                      {l.student_set_time ? ` · student asked for ${fmtWhen(l.next_followup_at).replace(/^Today /, "")}` : ""}
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
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}><Actions l={l} onOpen={onOpen} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
