"use client";

// Lead rows for the Leads page: the client's columns, one row per lead, click to open the form.
import type { CSSProperties } from "react";
import { R } from "@/components/report/kit";
import { DUE_WINDOW_MS, codeMeta, groupPhone, statusLabel, type LeadRow } from "@/lib/crm";
import { Tag, tdStyle, thStyle } from "./kit";

export type SortState = { sort: string; dir: "asc" | "desc" };

const IST = "Asia/Kolkata";
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
const time = (d: string) => new Date(d).toLocaleTimeString("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });

const STATUS_TONE: Record<string, [string, string]> = {
  new: ["#e7f0fb", "#2563a8"], retry: ["#f4ece0", "#7a6650"], callback: ["#f1e8fb", "#6b3fa0"],
  converted: ["#e3f4dd", "#2f6b2b"], dnc: ["#fbe7e3", "#a8402f"], dropped: ["#eee9e2", "#8a8278"],
};

/** Callbacks: "Due in 5 min" / "Due now" (blinks) or "Overdue"; no-contact retries whose wait is over: "Retry due". */
export function followUpAlert(l: LeadRow, now: number): { text: string; tone: "gold" | "bad" | "neu" } | null {
  if (!l.next_followup_at) return null;
  const diff = new Date(l.next_followup_at).getTime() - now;
  if (l.status === "retry") return diff <= 0 ? { text: "Retry due", tone: "neu" } : null;
  if (l.status !== "callback" || diff > DUE_WINDOW_MS) return null;
  if (-diff >= DUE_WINDOW_MS) return { text: "Overdue", tone: "bad" };
  return { text: diff > 60_000 ? `Due in ${Math.round(diff / 60_000)} min` : "Due now", tone: "gold" };
}

export function StatusPill({ l }: { l: Pick<LeadRow, "status" | "current_code"> }) {
  const [bg, fg] = STATUS_TONE[l.status] ?? STATUS_TONE.dropped;
  return <span title={codeMeta(l.current_code)?.rule} style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: bg, color: fg, whiteSpace: "nowrap" }}>{statusLabel(l)}</span>;
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, tableLayout: "fixed", minWidth: 1080 }}>
        {/* Fixed widths so every section lines up */}
        <colgroup>{[3, 9, 11, 10, 9, 10, 5, 5, 10, 9, 8, 11].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
        <thead><tr>
          {head("#")}{head("Received", "created_at")}{head("Name", "name")}{head("Contact")}{head("Representative")}{head("Status", "status")}
          {head("Amount")}{head("Guitar")}{head("Last contacted", "last_contacted_at")}{head("Follow-up date", "next_followup_at")}{head("Follow-up time")}{head("Follow-up alert")}
        </tr></thead>
        <tbody>
          {rows.map((l, i) => {
            const alert = followUpAlert(l, now);
            const f = l.next_followup_at && ["retry", "callback"].includes(l.status) ? l.next_followup_at : null;
            return (
              <tr key={l.id} className={`crm-row${alert && alert.tone === "gold" ? " crm-due" : ""}`} tabIndex={0} style={{ cursor: "pointer" }}
                onClick={() => onOpen(l.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(l.id)}>
                <td style={{ ...tdStyle, color: R.mute, fontSize: 12 }}>{start + i}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{day(l.created_at)}<div style={{ color: R.mute, fontSize: 11.5 }}>{time(l.created_at)}</div></td>
                <td style={tdStyle}>
                  <b>{l.name || "Unnamed"}</b>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                    {l.tags?.includes("re-enquired") && <Tag tone="gold">re-enquired</Tag>}
                    {l.locked_by_name && l.locked_by !== meId && <Tag title={`${l.locked_by_name} has this lead open`}>🔒 {l.locked_by_name.split(" ")[0]}</Tag>}
                  </div>
                </td>
                <td style={{ ...tdStyle, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{groupPhone(l.phone10)}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{l.assigned_to_name ?? <span style={{ color: "#c2b39c" }}>—</span>}</td>
                <td style={tdStyle}><StatusPill l={l} /></td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{l.amount ? `₹${Number(l.amount)}` : "—"}</td>
                <td style={{ ...tdStyle, fontSize: 12.5, fontWeight: 600, color: l.has_guitar ? R.good : l.has_guitar === false ? R.bad : "#c2b39c" }}>
                  {l.has_guitar == null ? "—" : l.has_guitar ? "Yes" : "No"}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{l.last_contacted_at ? <>{day(l.last_contacted_at)}<div style={{ color: R.mute, fontSize: 11.5 }}>{time(l.last_contacted_at)}</div></> : "—"}</td>
                <td style={{ ...tdStyle, fontSize: 12.5, fontWeight: f ? 700 : 400 }}>{f ? day(f) : "—"}</td>
                <td style={{ ...tdStyle, fontSize: 12.5, fontWeight: f ? 700 : 400, whiteSpace: "nowrap" }}>{f ? time(f) : "—"}</td>
                <td style={tdStyle}>{alert ? <Tag tone={alert.tone}>{alert.tone === "gold" ? "🔔 " : ""}{alert.text}</Tag> : <span style={{ color: "#c2b39c" }}>—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
