"use client";

// Lead rows for the Leads page: the client's columns, one row per lead, click to open the form.
// With `edit`, Assigned to / Status / Amount / Guitar / Last contacted / Next follow-up change right in the row (client, 8 Nov, 10 Nov).
import { useState, type CSSProperties, type MouseEvent } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { R } from "@/components/report/kit";
import { DUE_WINDOW_MS, groupPhone, openWati, type CodeMeta, type LeadRow, type WatiTemplates } from "@/lib/crm";
import { WatiIcon, WhatsAppIcon } from "@/components/ui/WABtn";
import { CodeChip, Tag, tdStyle, thStyle } from "./kit";
import { Icon } from "./icons";

export type SortState = { sort: string; dir: "asc" | "desc" };

const IST = "Asia/Kolkata";
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
const actBtn: CSSProperties = { width: 30, height: 30, borderRadius: 8, border: `1px solid ${R.line}`, background: R.card, color: R.ink,
  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, textDecoration: "none" };
// #, Received, Name, Contact, Assigned to (representative), Status, Amount, Guitar, Last contacted, Next follow-up, Follow-up alert, Actions
// (sums to the table's width on a 1440 px screen; wider screens share out the extra)
const COL_PX = [40, 94, 134, 112, 120, 66, 70, 64, 94, 112, 116, 118];
// Actions stays visible while the table scrolls sideways; its cell needs the row's own background
const STICKY_CSS = `
  .crm-sticky{position:sticky;right:0;z-index:1;box-shadow:-8px 0 10px -8px rgba(43,33,24,.18)}
  th.crm-sticky{background:${R.soft}}
  .crm-row .crm-sticky{background:${R.card}}
  .crm-row:hover .crm-sticky{background:${R.soft}}
  .crm-due .crm-sticky{background:#fff4dc}
  .crm-edit{position:relative;cursor:pointer}
  .crm-edit:hover{box-shadow:inset 0 0 0 1.5px ${R.gold};border-radius:8px}
  .crm-edit:focus-within{box-shadow:inset 0 0 0 2px ${R.gold};border-radius:8px}
  .crm-edit input.crm-typed:focus{opacity:1!important;background:${R.card};border-radius:8px;padding:0 11px;font:inherit;outline:none}`;
// An invisible native control over the cell: the cell keeps its look, a click opens the picker (a typed field shows itself while focused)
const OVERLAY: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: 0, padding: 0 };
const stop = (e: MouseEvent) => e.stopPropagation();
/** "YYYY-MM-DDTHH:mm" in IST, for a datetime-local picker (its value is read back as IST too). */
const istLocal = (d: string) => new Date(d).toLocaleString("sv-SE", { timeZone: IST, hour12: false }).slice(0, 16).replace(" ", "T");

export type TableEdit = {
  reps: { id: string; name: string }[];
  codes: CodeMeta[];
  patch: (l: LeadRow, p: { assigned_to?: string | null; has_guitar?: boolean | null; next_followup_at?: string; amount?: number | null; last_contacted_at?: string }) => void;
  status: (l: LeadRow, code: string) => void;
};
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

export default function LeadTable({ rows, onOpen, now, meId, sort, onSort, start = 1, serialFrom, newSince, edit, empty = "No leads here" }: {
  rows: LeadRow[]; onOpen: (id: string) => void; now: number; meId: string;
  sort?: SortState; onSort?: (s: SortState) => void; start?: number; empty?: string;
  /** Numbers count down from here (newest lead = highest number), else up from `start`. */
  serialFrom?: number;
  /** Leads received after this time get a "new" tag. */
  newSince?: number;
  edit?: TableEdit;
}) {
  const [watiErr, setWatiErr] = useState("");
  // same request as the lead form's template sender (SWR shares it); no WATI set up = no WATI button
  const { data: wati } = useSWR<WatiTemplates>("/crm/wati/templates", fetcher, { revalidateOnFocus: false });
  const watiOn = !!(wati?.configured && wati.inbox);
  if (!rows.length) return <p style={{ margin: "6px 2px 0", color: R.mute, fontSize: 13 }}>{empty}</p>;
  const head = (label: string, key?: string, style?: CSSProperties) => {
    const on = sort && key && sort.sort === key;
    const click = key && onSort ? () => onSort({ sort: key, dir: on && sort!.dir === "desc" ? "asc" : "desc" }) : undefined;
    return (
      <th key={label} className={label === "Actions" ? "crm-sticky" : undefined} style={{ ...thStyle, whiteSpace: "normal", padding: "10px 11px", ...style, cursor: click ? "pointer" : "default" }} onClick={click}
        aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
        {label}{on ? (sort!.dir === "asc" ? " ↑" : " ↓") : ""}
      </th>
    );
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <style>{STICKY_CSS}</style>
      {watiErr && <p role="alert" style={{ margin: "0 2px 8px", color: R.bad, fontSize: 13 }}>WATI: {watiErr}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, tableLayout: "fixed", minWidth: COL_PX.reduce((a, b) => a + b, 0) }}>
        {/* Fixed widths so every section lines up; narrower screens scroll sideways with Actions pinned */}
        <colgroup>{COL_PX.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead><tr>
          {head("#")}{head("Received", "created_at")}{head("Name", "name")}{head("Contact")}{head("Assigned to")}{head("Status", "status")}
          {head("Amount")}{head("Guitar")}{head("Last contacted", "last_contacted_at")}{head("Next follow-up", "next_followup_at")}{head("Follow-up alert")}{head("Actions")}
        </tr></thead>
        <tbody>
          {rows.map((l, i) => {
            const td = (extra?: CSSProperties): CSSProperties => ({ ...tdStyle, padding: "12px 11px", ...extra });
            const alert = followUpAlert(l, now);
            const f = l.next_followup_at && ["retry", "callback"].includes(l.status) ? l.next_followup_at : null;
            return (
              <tr key={l.id} className={`crm-row${alert && alert.tone === "gold" ? " crm-due" : ""}`} tabIndex={0} style={{ cursor: "pointer" }}
                onClick={() => onOpen(l.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(l.id)}>
                <td style={td({ color: R.mute, fontSize: 12, fontVariantNumeric: "tabular-nums" })}>{serialFrom !== undefined ? serialFrom - i : start + i}</td>
                <td style={td({ fontSize: 12.5, whiteSpace: "nowrap" })}>{day(l.created_at)}<div style={{ color: R.mute, fontSize: 11.5 }}>{time(l.created_at)}</div></td>
                <td style={td({ overflow: "hidden" })}>
                  {/* Sheet names can be long strings with no spaces or decorative Unicode: wrap anywhere, 2 lines max */}
                  <b title={l.name} style={NAME_CLAMP}>{l.name || "Unnamed"}</b>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                    {newSince !== undefined && new Date(l.created_at).getTime() > newSince && <Tag tone="ok" title="Arrived while this page was open">new</Tag>}
                    {l.tags?.includes("re-enquired") && <Tag tone="gold">re-enquired</Tag>}
                    {l.locked_by_name && l.locked_by !== meId && <Tag title={`${l.locked_by_name} has this lead open`}>🔒 {l.locked_by_name.split(" ")[0]}</Tag>}
                  </div>
                </td>
                <td style={td({ fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" })}>{groupPhone(l.phone10)}</td>
                <td className={edit ? "crm-edit" : undefined} style={td({ fontSize: 12.5, overflowWrap: "anywhere" })} onClick={edit && stop}>
                  {l.assigned_to_name ?? <span style={{ color: "#c2b39c" }}>—</span>}
                  {edit && <select aria-label={`Assigned to for ${l.name}`} value={l.assigned_to ?? ""} style={OVERLAY}
                    onChange={(e) => edit.patch(l, { assigned_to: e.target.value || null })}>
                    <option value="">— Not assigned —</option>
                    {edit.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>}
                </td>
                <td className={edit ? "crm-edit" : undefined} style={td()} onClick={edit && stop}>
                  {/* The letter only, in its colour; the full name on hover (client, 8 Nov) */}
                  {l.status === "new" || !l.current_code
                    ? <Tag tone="neu">{l.status === "dropped" ? "Dropped" : "New"}</Tag>
                    : <span title={edit?.codes.find((c) => c.code === l.current_code)?.label}><CodeChip code={l.current_code} big /></span>}
                  {edit && <select aria-label={`Status for ${l.name}`} value={l.status === "new" ? "" : l.current_code ?? ""} style={OVERLAY}
                    onChange={(e) => e.target.value && edit.status(l, e.target.value)}>
                    <option value="">{l.status === "new" ? "New: choose a status" : "Choose a status"}</option>
                    {edit.codes.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
                  </select>}
                </td>
                <td className={edit ? "crm-edit" : undefined} style={td({ fontSize: 12.5 })} onClick={edit && stop}>
                  {l.amount ? `₹${Number(l.amount)}` : "—"}
                  {edit && <input key={l.version} type="number" min={0} inputMode="decimal" placeholder="e.g. 299" className="crm-typed" aria-label={`Amount for ${l.name}`}
                    defaultValue={l.amount ? Number(l.amount) : ""} style={OVERLAY}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = l.amount ? String(Number(l.amount)) : ""; e.currentTarget.blur(); } }}
                    onBlur={(e) => { const v = Number(e.target.value) || null; if (v !== (l.amount ? Number(l.amount) : null)) edit.patch(l, { amount: v }); }} />}
                </td>
                <td className={edit ? "crm-edit" : undefined} style={td({ fontSize: 12.5, fontWeight: 600, color: l.has_guitar ? R.good : l.has_guitar === false ? R.bad : "#c2b39c" })} onClick={edit && stop}>
                  {l.has_guitar == null ? "—" : l.has_guitar ? "Yes" : "No"}
                  {edit && <select aria-label={`Guitar for ${l.name}`} value={l.has_guitar == null ? "" : l.has_guitar ? "yes" : "no"} style={OVERLAY}
                    onChange={(e) => edit.patch(l, { has_guitar: e.target.value === "" ? null : e.target.value === "yes" })}>
                    <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>}</td>
                {/* Set automatically when a status is saved; can be corrected here (not into the future) */}
                <td className={edit ? "crm-edit" : undefined} style={td({ fontSize: 12.5, whiteSpace: "nowrap" })} onClick={edit && stop}>
                  {l.last_contacted_at ? <>{day(l.last_contacted_at)}<div style={{ color: R.mute, fontSize: 11.5 }}>{time(l.last_contacted_at)}</div></> : "—"}
                  {edit && <input key={l.version} type="datetime-local" aria-label={`Last contacted for ${l.name}`} max={istLocal(new Date(now).toISOString())}
                    defaultValue={l.last_contacted_at ? istLocal(l.last_contacted_at) : ""} style={OVERLAY}
                    onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* older browsers open it on focus */ } }}
                    onBlur={(e) => { const v = e.target.value; if (v && v !== (l.last_contacted_at ? istLocal(l.last_contacted_at) : "")) edit.patch(l, { last_contacted_at: `${v}:00+05:30` }); }} />}
                </td>
                {/* Editable only when the status has a follow-up (retry / callback) */}
                <td className={edit && f ? "crm-edit" : undefined} style={td({ fontSize: 12.5, whiteSpace: "nowrap" })} onClick={edit && f ? stop : undefined}
                  title={edit && !f ? "Choose a status with a follow-up first" : undefined}>
                  {f ? <><b>{day(f)}</b><div style={{ fontWeight: 700, fontSize: 12 }}>{time(f)}</div></> : "—"}
                  {edit && f && <input type="datetime-local" aria-label={`Next follow-up for ${l.name}`} defaultValue={istLocal(f)} style={OVERLAY}
                    onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* older browsers open it on focus */ } }}
                    onBlur={(e) => { const v = e.target.value; if (v && v !== istLocal(f)) edit.patch(l, { next_followup_at: `${v}:00+05:30` }); }} />}
                </td>
                <td style={td()}>{alert ? <Tag tone={alert.tone}>{alert.tone === "gold" ? "🔔 " : ""}{alert.text}</Tag> : <span style={{ color: "#c2b39c" }}>—</span>}</td>
                <td className="crm-sticky" style={td({ whiteSpace: "nowrap" })} onClick={(e) => e.stopPropagation()}>
                  <span style={{ display: "inline-flex", gap: 5 }}>
                    <a className="crm-btn" style={{ ...actBtn, color: "#1fa855" }} href={`https://wa.me/91${l.phone10}`} target="_blank" rel="noopener noreferrer"
                      title="Chat on WhatsApp" aria-label={`WhatsApp ${l.name}`}><WhatsAppIcon size={15} /></a>
                    {watiOn && <button className="crm-btn" style={actBtn} title="Open this chat in WATI" aria-label={`Open ${l.name} in WATI`}
                      onClick={() => { setWatiErr(""); openWati(l.id).catch((e) => setWatiErr((e as Error).message)); }}><WatiIcon size={19} /></button>}
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
