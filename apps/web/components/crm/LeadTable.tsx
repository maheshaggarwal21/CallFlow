"use client";

// Lead rows for the Leads page: the client's columns, one row per lead, click to open the form.
import type { CSSProperties } from "react";
import { R } from "@/components/report/kit";
import { DUE_WINDOW_MS, groupPhone, type LeadRow } from "@/lib/crm";
import { WhatsAppIcon } from "@/components/ui/WABtn";
import { StatusBadge, Tag, tdStyle, thStyle } from "./kit";
import { Icon } from "./icons";

export type SortState = { sort: string; dir: "asc" | "desc" };

const IST = "Asia/Kolkata";
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
const actBtn: CSSProperties = { width: 30, height: 30, borderRadius: 8, border: `1px solid ${R.line}`, background: R.card, color: R.ink,
  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, textDecoration: "none" };
const NAME_CLAMP: CSSProperties = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere", wordBreak: "break-word" };
const time = (d: string) => new Date(d).toLocaleTimeString("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });

/** Callbacks: "Due in 5 min" / "Due now" (blinks) or "Overdue"; no-contact retries whose wait is over: "Retry due". */
export function followUpAlert(l: LeadRow, now: number): { text: string; tone: "gold" | "bad" | "neu" } | null {
  if (!l.next_followup_at) return null;
  const diff = new Date(l.next_followup_at).getTime() - now;
  if (l.status === "retry") return diff <= 0 ? { text: "Retry due", tone: "neu" } : null;
  if (l.status !== "callback" || diff > DUE_WINDOW_MS) return null;
  if (-diff >= DUE_WINDOW_MS) return { text: "Overdue", tone: "bad" };
  return { text: diff > 60_000 ? `Due in ${Math.round(diff / 60_000)} min` : "Due now", tone: "gold" };
}

export default function LeadTable({ rows, onOpen, now, meId, sort, onSort, start = 1, empty = "No leads here" }: {
  rows: LeadRow[]; onOpen: (id: string) => void; now: number; meId: string;
  sort?: SortState; onSort?: (s: SortState) => void; start?: number; empty?: string;
}) {
  if (!rows.length) return <p style={{ margin: "6px 2px 0", color: R.mute, fontSize: 13 }}>{empty}</p>;
  const head = (label: string, key?: string, style?: CSSProperties) => {
    const on = sort && key && sort.sort === key;
    const click = key && onSort ? () => onSort({ sort: key, dir: on && sort!.dir === "desc" ? "asc" : "desc" }) : undefined;
    return (
      <th key={label} style={{ ...thStyle, whiteSpace: "normal", ...style, cursor: click ? "pointer" : "default" }} onClick={click}
        aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
        {label}{on ? (sort!.dir === "asc" ? " ↑" : " ↓") : ""}
      </th>
    );
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, tableLayout: "fixed", minWidth: 1100 }}>
        {/* Fixed widths so every section lines up */}
        <colgroup>{[2.6, 7.8, 10.5, 9.6, 9.1, 10.9, 5, 4.8, 7.8, 8, 6.8, 9.1, 8].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
        <thead><tr>
          {head("#")}{head("Received", "created_at")}{head("Name", "name")}{head("Contact")}{head("Representative")}{head("Status", "status")}
          {head("Amount")}{head("Guitar")}{head("Last contacted", "last_contacted_at")}{head("Follow-up date", "next_followup_at")}{head("Follow-up time")}{head("Follow-up alert")}{head("Actions")}
        </tr></thead>
        <tbody>
          {rows.map((l, i) => {
            const td = (extra?: CSSProperties): CSSProperties => ({ ...tdStyle, padding: "10px 8px", ...extra });
            const alert = followUpAlert(l, now);
            const f = l.next_followup_at && ["retry", "callback"].includes(l.status) ? l.next_followup_at : null;
            return (
              <tr key={l.id} className={`crm-row${alert && alert.tone === "gold" ? " crm-due" : ""}`} tabIndex={0} style={{ cursor: "pointer" }}
                onClick={() => onOpen(l.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(l.id)}>
                <td style={td({ color: R.mute, fontSize: 12 })}>{start + i}</td>
                <td style={td({ fontSize: 12.5, whiteSpace: "nowrap" })}>{day(l.created_at)}<div style={{ color: R.mute, fontSize: 11.5 }}>{time(l.created_at)}</div></td>
                <td style={td({ overflow: "hidden" })}>
                  {/* Sheet names can be long strings with no spaces or decorative Unicode: wrap anywhere, 2 lines max */}
                  <b title={l.name} style={NAME_CLAMP}>{l.name || "Unnamed"}</b>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                    {l.tags?.includes("re-enquired") && <Tag tone="gold">re-enquired</Tag>}
                    {l.locked_by_name && l.locked_by !== meId && <Tag title={`${l.locked_by_name} has this lead open`}>🔒 {l.locked_by_name.split(" ")[0]}</Tag>}
                  </div>
                </td>
                <td style={td({ fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" })}>{groupPhone(l.phone10)}</td>
                <td style={td({ fontSize: 12.5, overflowWrap: "anywhere" })}>{l.assigned_to_name ?? <span style={{ color: "#c2b39c" }}>—</span>}</td>
                <td style={td({ overflow: "hidden" })}><StatusBadge l={l} wrap /></td>
                <td style={td({ fontSize: 12.5 })}>{l.amount ? `₹${Number(l.amount)}` : "—"}</td>
                <td style={td({ fontSize: 12.5, fontWeight: 600, color: l.has_guitar ? R.good : l.has_guitar === false ? R.bad : "#c2b39c" })}>
                  {l.has_guitar == null ? "—" : l.has_guitar ? "Yes" : "No"}</td>
                <td style={td({ fontSize: 12.5, whiteSpace: "nowrap" })}>{l.last_contacted_at ? <>{day(l.last_contacted_at)}<div style={{ color: R.mute, fontSize: 11.5 }}>{time(l.last_contacted_at)}</div></> : "—"}</td>
                <td style={td({ fontSize: 12.5, fontWeight: f ? 700 : 400, whiteSpace: "nowrap" })}>{f ? day(f) : "—"}</td>
                <td style={td({ fontSize: 12.5, fontWeight: f ? 700 : 400, whiteSpace: "nowrap" })}>{f ? time(f) : "—"}</td>
                <td style={td()}>{alert ? <Tag tone={alert.tone}>{alert.tone === "gold" ? "🔔 " : ""}{alert.text}</Tag> : <span style={{ color: "#c2b39c" }}>—</span>}</td>
                <td style={td({ whiteSpace: "nowrap" })} onClick={(e) => e.stopPropagation()}>
                  <span style={{ display: "inline-flex", gap: 5 }}>
                    <a className="crm-btn" style={{ ...actBtn, color: "#1fa855" }} href={`https://wa.me/91${l.phone10}`} target="_blank" rel="noopener noreferrer"
                      title="Chat on WhatsApp" aria-label={`WhatsApp ${l.name}`}><WhatsAppIcon size={15} /></a>
                    <button className="crm-btn" style={{ ...actBtn, color: R.out }} onClick={() => onOpen(l.id)} title="Open lead form" aria-label={`Open lead form for ${l.name}`}>
                      <Icon name="open" size={15} /></button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
