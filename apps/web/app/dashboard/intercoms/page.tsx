"use client";

// Intercoms: connections (client's PDF, 28 Nov 2026; docs/EMPLOYEE-LOGIN-PLAN.md). Each row is a line as the KoreCall
// box numbers it, the calling number on it and its office. Reps connect themselves with the employee login and a test
// call; this page shows who is on each line, frees a line, and connects someone by hand when the box is offline.
// Add connection suggests the next line number. Every row saves on its own.
import { useMemo, useState, type CSSProperties } from "react";
import useSWR from "swr";
import { C, eClr } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import { S } from "@/components/salary/kit";
import type { Line, TeamsResponse } from "@callflow/shared-types";

const COLS = "26px 64px minmax(124px,1fr) minmax(118px,1fr) minmax(170px,1.5fr) 62px 176px";
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
  const [connecting, setConnecting] = useState<Line | null>(null);
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
          Create your offices on the <a href="/dashboard/teams" style={{ color: C.orange, fontWeight: 700 }}>Offices</a> tab first (with each office&apos;s test number), then add connections here.
        </p>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, fontSize: 14, fontWeight: 600, color: msg.ok ? C.green : C.red }}>{msg.text}</p>}

      {gaps.length > 0 && (
        <div role="status" style={{ padding: "12px 16px", background: C.orangeLight, border: `1px solid ${C.orangeBdr}`, borderRadius: 12, fontSize: 13.5, color: C.text }}>
          {gaps.map((l) => (
            <div key={l.id}>⚠ <b>Line {l.line_number}</b>: {l.gap_calls} call{l.gap_calls === 1 ? "" : "s"}
              {l.freed_at ? ` since ${new Date(l.freed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : " this month"} came in with no one connected, so they count for nobody.</div>
          ))}
          <div style={{ marginTop: 4, color: C.textSub }}>Use <b>Connect by hand</b> on that line and tick the box to give them to the person.</div>
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
              <Row key={l.id + (l.calling_number ?? "") + (l.team_id ?? "") + l.line_number} n={i + 1} line={l} offices={offices}
                draft={{ line_number: l.line_number, calling_number: l.calling_number ?? "", team_id: l.team_id ?? "" }}
                onSave={(d) => run(api.patch(`/lines/${l.id}`, {
                  ...(d.line_number.padStart(2, "0") !== l.line_number ? { line_number: d.line_number } : {}),
                  calling_number: d.calling_number || null, team_id: d.team_id || null,
                }), `Line ${d.line_number.padStart(2, "0")} saved.`)}
                onFree={() => run(api.patch(`/lines/${l.id}`, { employee_id: null }), `Line ${l.line_number} is free.`)}
                onConnect={() => setConnecting(l)}
                onDelete={() => run(api.delete(`/lines/${l.id}`), `Line ${l.line_number} removed. Its past calls keep their line and number.`)} />
            ))}
          </div>
        </div>
      )}

      {connecting && (
        <ConnectByHand line={connecting} taken={new Set((lines ?? []).filter((l) => l.employee_id).map((l) => l.employee_id!))} onClose={() => setConnecting(null)}
          onDone={async (body, name) => { if (await run(api.patch(`/lines/${connecting.id}`, body), `${name} connected on line ${connecting.line_number}.`)) setConnecting(null); }} />
      )}
    </div>
  );
}

function Row({ n, line, draft: initial, offices, isNew, onSave, onCancel, onFree, onConnect, onDelete }: {
  n: number; line?: Line; draft: Draft; offices: TeamsResponse["teams"]; isNew?: boolean;
  onSave: (d: Draft) => Promise<unknown> | void; onCancel?: () => void; onFree?: () => void; onConnect?: () => void; onDelete?: () => void;
}) {
  const [d, setD] = useState(initial);
  const [confirm, setConfirm] = useState<"free" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = isNew || d.line_number !== initial.line_number || d.calling_number !== initial.calling_number || d.team_id !== initial.team_id;
  const held = !!line?.employee_id;
  const save = async () => { setBusy(true); try { await onSave(d); } finally { setBusy(false); } };
  const who = line?.employee_name;
  const clr = line?.employee_color || eClr(line?.employee_color_index ?? 0).t;

  return (
    <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${C.borderLight}`, background: isNew ? C.orangeLight : undefined }}>
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
      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {isNew ? <span style={{ fontSize: 13, color: C.muted }}>—</span> : who ? (
          <>
            <span aria-hidden style={{ width: 32, height: 32, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", background: clr, color: "#fff", fontWeight: 800, fontSize: 13 }}>
              {who.trim().slice(0, 1).toUpperCase()}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
              <span style={{ fontSize: 12, color: C.muted }}>
                {line?.employee_code != null && `Reg No. ${line.employee_code}`}
                {line?.connected_at && ` · since ${time(line.connected_at)}`}{line?.connected_via === "admin" ? " · by hand" : line?.connected_via === "test" ? " · tested ✓" : ""}
              </span>
            </span>
          </>
        ) : <span style={{ fontSize: 13.5, color: C.dim }}>Free</span>}
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: line?.call_count_today ? C.orange : C.dim }}>{isNew ? "—" : line?.call_count_today ?? 0}</span>
      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {confirm ? (
          <>
            <span style={{ fontSize: 12.5, color: C.textSub, alignSelf: "center" }}>{confirm === "free" ? `Free from ${who}?` : "Remove this line?"}</span>
            <button onClick={() => { setConfirm(null); (confirm === "free" ? onFree : onDelete)?.(); }} style={small("red")}>Yes</button>
            <button onClick={() => setConfirm(null)} style={small("plain")}>No</button>
          </>
        ) : (
          <>
            {(dirty || isNew) && <button disabled={busy || !d.line_number} onClick={save} style={{ ...small("orange"), opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>}
            {isNew && <button onClick={onCancel} style={small("plain")}>Cancel</button>}
            {!isNew && held && <button onClick={() => setConfirm("free")} style={small("red")}>Free line</button>}
            {!isNew && !held && !dirty && <button onClick={onConnect} style={small("plain")}>Connect by hand</button>}
            {!isNew && !held && !dirty && <button onClick={() => setConfirm("delete")} aria-label={`Remove line ${line?.line_number}`} title="Remove this line" style={small("plain")}>✕</button>}
          </>
        )}
      </span>
    </div>
  );
}

/** The fallback when a test call can't get through (box offline): an admin puts a person on the line. */
function ConnectByHand({ line, taken, onClose, onDone }: {
  line: Line; taken: Set<string>; onClose: () => void; onDone: (body: { employee_id: string; claim_gap?: boolean }, name: string) => void;
}) {
  const { data: people } = useSWR<{ id: string; name: string }[]>("/employees/names", fetcher);
  const [pick, setPick] = useState("");
  const [claim, setClaim] = useState(false);
  const free = (people ?? []).filter((p) => !taken.has(p.id));
  const name = free.find((p) => p.id === pick)?.name ?? "";
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(43,33,24,0.35)", zIndex: 300 }} />
      <div role="dialog" aria-label={`Connect someone on line ${line.line_number}`} style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 301,
        width: "min(420px, calc(100vw - 32px))", ...S.card, padding: "20px 22px" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800, color: C.text }}>Connect by hand · line {line.line_number}</h3>
        <p style={{ margin: "0 0 14px", fontSize: 13.5, color: C.muted }}>For when a test call can&apos;t get through. Calls on this line will go to the person you pick until they log out or go idle.</p>
        <label><span style={{ ...S.label, display: "block", marginBottom: 6 }}>Person</span>
          <select autoFocus value={pick} onChange={(e) => setPick(e.target.value)} style={field}>
            <option value="">Pick someone without a line…</option>
            {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {line.gap_calls > 0 && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13.5, color: C.text }}>
            <input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} />
            Also give them the {line.gap_calls} call{line.gap_calls === 1 ? "" : "s"} that came in with no one on this line
          </label>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={S.btn}>Cancel</button>
          <button disabled={!pick} onClick={() => onDone({ employee_id: pick, ...(claim ? { claim_gap: true } : {}) }, name)} style={{ ...S.btnPrimary, opacity: pick ? 1 : 0.5 }}>Connect</button>
        </div>
      </div>
    </>
  );
}
