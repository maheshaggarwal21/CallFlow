"use client";

// Intercoms: connections (client's PDF, 28 Nov 2026; docs/EMPLOYEE-LOGIN-PLAN.md). Each row is a line as the KoreCall
// box numbers it, the calling number on it and its office. Reps connect themselves with the employee login and a test
// call; here an admin can also pick who is on a line from the Connected dropdown (gives it to them with no test call,
// and logs out whoever had it) or free it. Add connection suggests the next line number. Every row saves on its own.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import useSWR from "swr";
import { C, eClr } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import { S } from "@/components/salary/kit";
import type { EmployeeName, Line, TeamsResponse } from "@callflow/shared-types";

const COLS = "26px 64px minmax(124px,1fr) minmax(118px,1fr) minmax(230px,1.8fr) 62px 120px";
const field: CSSProperties = { ...S.input, background: C.card, fontSize: 14, padding: "8px 10px" };
const small = (tone: "orange" | "red" | "plain"): CSSProperties => ({
  padding: "7px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
  ...(tone === "orange" ? { border: "none", background: C.orange, color: "#fff" }
    : tone === "red" ? { border: `1px solid ${C.redBdr}`, background: C.redLight, color: C.red }
    : { border: `1px solid ${C.border}`, background: C.bgDeep, color: C.textSub }),
});
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const pad = (n: number) => String(n).padStart(2, "0");

type Draft = { line_number: string; calling_number: string; team_id: string };

export default function IntercomsPage() {
  const { data: lines, mutate, isLoading } = useSWR<Line[]>("/lines", fetcher, { refreshInterval: 15_000 });
  const { data: teams } = useSWR<TeamsResponse>("/teams", fetcher);
  const offices = teams?.teams ?? [];
  const [office, setOffice] = useState("all");
  const [adding, setAdding] = useState<Draft | null>(null);
  const { data: people } = useSWR<EmployeeName[]>("/employees/names", fetcher);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const shown = useMemo(() => (lines ?? []).filter((l) => office === "all" || (office === "none" ? !l.team_id : l.team_id === office)), [lines, office]);
  const nextLine = pad(Math.max(0, ...(lines ?? []).map((l) => Number(l.line_number) || 0)) + 1);
  const gaps = (lines ?? []).filter((l) => l.gap_calls > 0);
  const onLine = (lines ?? []).filter((l) => l.employee_id).length;

  const run = async (p: Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await p; await mutate(); setMsg({ ok: true, text: ok }); return true; } catch (e) { setMsg({ ok: false, text: (e as Error).message }); return false; }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={S.h1}>Intercoms</h1>
          <p style={S.sub}>Your connections: each line, the calling number on it and its office. Reps connect themselves with a test call.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>
            {onLine}<span style={{ fontSize: 16, color: C.muted, fontWeight: 500 }}> / {(lines ?? []).length}</span>
          </p>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>lines in use</p>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <label style={{ minWidth: 220 }}>
          <span style={{ ...S.label, display: "block", marginBottom: 6 }}>Office</span>
          <select value={office} onChange={(e) => setOffice(e.target.value)} style={field}>
            <option value="all">All offices</option>
            {offices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {(lines ?? []).some((l) => !l.team_id) && <option value="none">No office set</option>}
          </select>
        </label>
        {!adding && (
          <button onClick={() => setAdding({ line_number: nextLine, calling_number: "", team_id: office !== "all" && office !== "none" ? office : offices[0]?.id ?? "" })} style={S.btnPrimary}>
            <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> Add connection
          </button>
        )}
      </div>

      {offices.length === 0 && teams && (
        <p style={{ margin: 0, padding: "12px 16px", background: C.orangeLight, border: `1px solid ${C.orangeBdr}`, borderRadius: 12, fontSize: 13.5, color: C.text }}>
          Create your offices on the <a href="/dashboard/teams" style={{ color: C.orange, fontWeight: 700 }}>Offices</a> tab first, then add connections here.
        </p>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, fontSize: 14, fontWeight: 600, color: msg.ok ? C.green : C.red }}>{msg.text}</p>}

      {gaps.length > 0 && (
        <div role="status" style={{ padding: "12px 16px", background: C.orangeLight, border: `1px solid ${C.orangeBdr}`, borderRadius: 12, fontSize: 13.5, color: C.text }}>
          {gaps.map((l) => (
            <div key={l.id}>⚠ <b>Line {l.line_number}</b>: {l.gap_calls} call{l.gap_calls === 1 ? "" : "s"}
              {l.freed_at ? ` since ${new Date(l.freed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : " this month"} came in with no one connected, so they count for nobody.</div>
          ))}
          <div style={{ marginTop: 4, color: C.textSub }}>Pick the person in that line&apos;s <b>Connected</b> dropdown and tick the box to give them those calls.</div>
        </div>
      )}

      {isLoading ? <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p> : (
        <div style={{ ...S.card, overflowX: "auto" }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "12px 18px", background: C.bgDeep, borderBottom: `1px solid ${C.border}`, borderRadius: "16px 16px 0 0" }}>
              {["#", "Line", "Calling number", "Office", "Connected", "Calls", ""].map((h, i) => <span key={i} style={S.th}>{h}</span>)}
            </div>
            {adding && (
              <Row key="new" n={0} draft={adding} offices={offices} isNew
                onSave={async (d) => { if (await run(api.post("/lines", { line_number: d.line_number, calling_number: d.calling_number || null, team_id: d.team_id || null }), `Line ${d.line_number.padStart(2, "0")} added.`)) setAdding(null); }}
                onCancel={() => setAdding(null)} />
            )}
            {shown.length === 0 && !adding && (
              <p style={{ margin: 0, padding: "28px 18px", textAlign: "center", color: C.muted, fontSize: 14 }}>
                No connections{office !== "all" ? " in this office" : ""} yet. Press <b style={{ color: C.orange }}>+ Add connection</b>.
              </p>
            )}
            {shown.map((l, i) => (
              <Row key={l.id + (l.calling_number ?? "") + (l.team_id ?? "") + l.line_number} n={i + 1} line={l} offices={offices} people={people ?? []} lines={lines ?? []}
                draft={{ line_number: l.line_number, calling_number: l.calling_number ?? "", team_id: l.team_id ?? "" }}
                onSave={(d) => run(api.patch(`/lines/${l.id}`, {
                  ...(d.line_number.padStart(2, "0") !== l.line_number ? { line_number: d.line_number } : {}),
                  calling_number: d.calling_number || null, team_id: d.team_id || null,
                }), `Line ${d.line_number.padStart(2, "0")} saved.`)}
                onAssign={(p, claim) => run(api.patch(`/lines/${l.id}`, p ? { employee_id: p.id, move: true, ...(claim ? { claim_gap: true } : {}) } : { employee_id: null }),
                  p ? `${p.name} is on line ${l.line_number}.` : `Line ${l.line_number} is free.`)}
                onDelete={() => run(api.delete(`/lines/${l.id}`), `Line ${l.line_number} removed. Its past calls keep their line and number.`)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Person = EmployeeName;
const personColor = (p: { color?: string | null; color_index?: number | null }) => p.color || eClr(p.color_index ?? 0).t;
const Avatar = ({ name, color }: { name: string; color: string }) => (
  <span aria-hidden style={{ width: 32, height: 32, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", background: color, color: "#fff", fontWeight: 800, fontSize: 13 }}>
    {name.trim().slice(0, 1).toUpperCase()}</span>
);

function Row({ n, line, draft: initial, offices, people = [], lines = [], isNew, onSave, onCancel, onAssign, onDelete }: {
  n: number; line?: Line; draft: Draft; offices: TeamsResponse["teams"]; people?: Person[]; lines?: Line[]; isNew?: boolean;
  onSave: (d: Draft) => Promise<unknown> | void; onCancel?: () => void; onAssign?: (p: Person | null, claimGap: boolean) => Promise<unknown>; onDelete?: () => void;
}) {
  const [d, setD] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // the person picked in the Connected dropdown (null = free the line), waiting for Yes
  const [pending, setPending] = useState<{ p: Person | null } | null>(null);
  const [claim, setClaim] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = isNew || d.line_number !== initial.line_number || d.calling_number !== initial.calling_number || d.team_id !== initial.team_id;
  const held = !!line?.employee_id;
  const save = async () => { setBusy(true); try { await onSave(d); } finally { setBusy(false); } };
  const who = line?.employee_name;
  const otherLine = (id: string) => lines.find((l) => l.employee_id === id && l.id !== line?.id)?.line_number;
  const assign = async () => {
    if (!pending) return;
    setBusy(true);
    try { await onAssign?.(pending.p, claim); setPending(null); setClaim(false); } finally { setBusy(false); }
  };

  return (
    <div style={{ borderBottom: `1px solid ${C.borderLight}`, background: isNew ? C.orangeLight : undefined }}>
      <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, alignItems: "center", padding: "12px 18px" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.blue }}>{isNew ? "new" : `${n}.`}</span>
        <input aria-label="Line" value={d.line_number} inputMode="numeric" maxLength={3} disabled={held}
          title={held ? "Free the line before changing its number" : "The line number the KoreCall box uses"}
          onChange={(e) => setD({ ...d, line_number: e.target.value.replace(/\D/g, "") })} style={{ ...field, fontWeight: 800, textAlign: "center", opacity: held ? 0.6 : 1 }} />
        <input aria-label="Calling number" value={d.calling_number} inputMode="tel" maxLength={18} placeholder="number on this line"
          onChange={(e) => setD({ ...d, calling_number: e.target.value })} style={field} />
        <select aria-label="Office" value={d.team_id} onChange={(e) => setD({ ...d, team_id: e.target.value })} style={field}>
          <option value="">— No office —</option>
          {offices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {isNew || !line ? <span style={{ fontSize: 13, color: C.muted }}>—</span> : (
          <AgentPicker line={line} people={people} otherLine={otherLine} onPick={(p) => { setClaim(false); setPending({ p }); }} />
        )}
        <span style={{ fontSize: 14, fontWeight: 700, color: line?.call_count_today ? C.orange : C.dim }}>{isNew ? "—" : line?.call_count_today ?? 0}</span>
        <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {confirmDelete ? (
            <>
              <span style={{ fontSize: 12.5, color: C.textSub, alignSelf: "center" }}>Remove?</span>
              <button onClick={() => { setConfirmDelete(false); onDelete?.(); }} style={small("red")}>Yes</button>
              <button onClick={() => setConfirmDelete(false)} style={small("plain")}>No</button>
            </>
          ) : (
            <>
              {(dirty || isNew) && <button disabled={busy || !d.line_number} onClick={save} style={{ ...small("orange"), opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>}
              {isNew && <button onClick={onCancel} style={small("plain")}>Cancel</button>}
              {!isNew && !held && !dirty && <button onClick={() => setConfirmDelete(true)} aria-label={`Remove line ${line?.line_number}`} title="Remove this line" style={small("plain")}>✕</button>}
            </>
          )}
        </span>
      </div>
      {pending && line && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 18px 12px", padding: "10px 14px", borderRadius: 10, background: C.orangeLight, border: `1px solid ${C.orangeBdr}`, fontSize: 13.5, color: C.text }}>
          <span style={{ flex: "1 1 300px" }}>
            {pending.p ? <>Give line <b>{line.line_number}</b> to <b>{pending.p.name}</b>{pending.p.employee_code != null && ` (Reg No. ${pending.p.employee_code})`}? Their calls on this line count for them from now, no test call needed.</>
              : <>Free line <b>{line.line_number}</b>?</>}
            {who && <> <b>{who}</b> will be logged out.</>}
            {pending.p && otherLine(pending.p.id) && <> {pending.p.name} leaves line {otherLine(pending.p.id)}, which becomes free.</>}
          </span>
          {pending.p && line.gap_calls > 0 && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} />
              Also give them the {line.gap_calls} call{line.gap_calls === 1 ? "" : "s"} that came in with no one on this line
            </label>
          )}
          <span style={{ display: "flex", gap: 6 }}>
            <button disabled={busy} onClick={assign} style={{ ...small(pending.p ? "orange" : "red"), opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Yes"}</button>
            <button disabled={busy} onClick={() => setPending(null)} style={small("plain")}>No</button>
          </span>
        </div>
      )}
    </div>
  );
}

/** The Connected cell: who is on the line, as before, opening a list of everyone to give the line to (or free it). */
function AgentPicker({ line, people, otherLine, onPick }: { line: Line; people: Person[]; otherLine: (id: string) => string | undefined; onPick: (p: Person | null) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number }>({ left: 0, width: 280 });
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const who = line.employee_name;
  // "Free" first when someone is on it; the person on it isn't offered again
  const options: (Person | null)[] = [...(line.employee_id ? [null] : []), ...people.filter((p) => p.id !== line.employee_id)];

  const show = () => {
    const r = btn.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > 300;
    setPos({ left: r.left, width: Math.max(r.width, 280), ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }) });
    setActive(0);
    setOpen(true);
  };
  // the list is fixed to the screen (the table scrolls sideways), so it closes on any scroll or outside click
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const scrolled = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", () => setOpen(false), { once: true });
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("scroll", scrolled, true); };
  }, [open]);

  const choose = (p: Person | null) => { setOpen(false); onPick(p); btn.current?.focus(); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      setActive((i) => Math.min(options.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1))));
    }
    if (e.key === "Enter" && open && active < options.length) { e.preventDefault(); choose(options[active]); }
  };

  return (
    <>
      <button ref={btn} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Who is on line ${line.line_number}`}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={key}
        style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, width: "100%", padding: "4px 8px", margin: "-4px -8px", borderRadius: 10,
          border: `1px solid ${open ? C.orange : "transparent"}`, background: open ? C.card : "transparent", cursor: "pointer", textAlign: "left", font: "inherit" }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.borderColor = C.border; }} onMouseLeave={(e) => { if (!open) e.currentTarget.style.borderColor = "transparent"; }}>
        {who ? (
          <>
            <Avatar name={who} color={line.employee_color || eClr(line.employee_color_index ?? 0).t} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
              <span style={{ fontSize: 12, color: C.muted }}>
                {line.employee_code != null && `Reg No. ${line.employee_code}`}
                {line.connected_at && ` · since ${time(line.connected_at)}`}{line.connected_via === "admin" ? " · by admin" : line.connected_via === "test" ? " · tested ✓" : ""}
              </span>
            </span>
          </>
        ) : <span style={{ flex: 1, fontSize: 13.5, color: C.dim }}>Free</span>}
        <span aria-hidden style={{ color: C.muted, fontSize: 11, flex: "none" }}>▼</span>
      </button>
      {open && (
        <div ref={list} role="listbox" aria-label={`Give line ${line.line_number} to`} style={{
          position: "fixed", zIndex: 400, left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: 300, overflowY: "auto", padding: 6,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 14px 36px rgba(43,33,24,0.18)" }}>
          {options.length === 0 && <div style={{ padding: 10, fontSize: 13.5, color: C.muted }}>No one to pick.</div>}
          {options.map((p, i) => {
            const elsewhere = p && otherLine(p.id);
            return (
              <div key={p?.id ?? "free"} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => choose(p)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, cursor: "pointer", background: i === active ? C.orangeLight : "transparent" }}>
                {p ? (
                  <>
                    <Avatar name={p.name} color={personColor(p)} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      <span style={{ fontSize: 12, color: C.muted }}>{p.employee_code != null ? `Reg No. ${p.employee_code}` : "No Reg No"}{elsewhere ? ` · on line ${elsewhere}` : ""}</span>
                    </span>
                  </>
                ) : <span style={{ fontSize: 13.5, fontWeight: 700, color: C.red, padding: "6px 0" }}>Free this line (no one)</span>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
