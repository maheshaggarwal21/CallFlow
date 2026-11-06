"use client";

// CRM Reports (owner or view_crm_reports): per-rep outcomes, code funnel, reasons, the three
// mismatch lists, code-vs-call-check flags, matching errors and the daily F digest preview.
import { useState, type CSSProperties, type ReactNode } from "react";
import useSWR from "swr";
import { Avatar, Panel, R, dur, pct } from "@/components/report/kit";
import PeriodSelect from "@/components/ui/PeriodSelect";
import { usePeriodRange } from "@/hooks/usePeriodRange";
import { useAuth } from "@/hooks/useAuth";
import { useCrmMe } from "@/hooks/useCrmMe";
import { api, fetcher } from "@/lib/api";
import { CHECK_LABEL, CODES, LIKELY_LABEL, codeMeta, fmtWhen, groupPhone } from "@/lib/crm";
import { BandTile, Btn, CRM_CSS, CodeChip, HeaderBand, PendingTag, Tag, tdStyle, thStyle } from "@/components/crm/kit";
import LeadDrawer from "@/components/crm/LeadDrawer";

type Rep = { id: string; name: string; employee_code: number; dials: number; forms: number; likely: number } & Record<string, number>;
type Mini = { lead_id: string; lead_code: string; lead_name: string; rep: string | null };
type Report = {
  reps: Rep[];
  funnel: { worked: number; connected: number; talked: number; interested: number; paid: number };
  reasons: { z: { reason: string; n: number; share: number }[]; de: { reason: string; n: number; share: number }[] };
  mismatches: {
    forms_without_recording: (Mini & { id: string; created_at: string; code: string; reason: string | null; phone10: string })[];
    recordings_without_form: (Mini & { id: string; called_at: string; duration_secs: number; phone10: string })[];
    probable_typos: (Mini & { interaction_id: string; call_id: string; created_at: string; code: string; form_phone: string; call_phone: string; called_at: string; duration_secs: number })[];
  };
  contradictions: (Mini & { id: string; created_at: string; code: string; check_label: string; confidence: number; duration_secs: number })[];
  call_check_mode: string;
  match_errors: { total: number; last_24h: number; latest: { call_id: string; error: string; created_at: string }[] | null };
};

const card: CSSProperties = { background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "16px 18px", minWidth: 0 };
const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 14, alignItems: "start" };

export default function CrmReportsPage() {
  const { can, loaded } = useCrmMe();
  const { isOwner } = useAuth();
  const { params, selectProps } = usePeriodRange();
  const allowed = can("view_crm_reports");
  const { data, error, mutate } = useSWR<Report>(allowed ? `/crm/reports?${params}` : null, fetcher);
  const [open, setOpen] = useState<string | null>(null);

  if (loaded && !allowed) return <p style={{ color: R.mute, padding: 8 }}>CRM Reports need the "View CRM reports" permission. Ask the owner.</p>;
  const forms = data?.reps.reduce((a, r) => a + r.forms, 0) ?? 0;
  const likely = data?.reps.reduce((a, r) => a + r.likely, 0) ?? 0;
  const paid = data?.reps.reduce((a, r) => a + (r.F ?? 0), 0) ?? 0;
  const mm = data?.mismatches;

  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gap: 14 }}>
      <style>{CRM_CSS}</style>
      <HeaderBand eyebrow="CRM" title="CRM Reports" sub="Outcomes saved by the reps, matched against KoreCall recordings" right={<PeriodSelect {...selectProps} />}>
        <div className="crm-g5">
          <BandTile label="Forms saved" value={data ? forms : "—"} sub="call outcomes" />
          <BandTile label="Likely conversations" value={data ? likely : "—"} sub="≥30 s, coded D/E/F/Z" />
          <BandTile label="Paid trials" value={data ? paid : "—"} sub={data && forms ? `${pct(paid / forms)} of forms` : "₹299 each"} accent="#a9d39b" />
          <BandTile label="Mismatches" value={mm ? mm.forms_without_recording.length + mm.recordings_without_form.length + mm.probable_typos.length : "—"} sub="form ↔ recording" accent="#f2a594" />
          <BandTile label="Matching errors" value={data ? data.match_errors.total : "—"} sub={data ? `${data.match_errors.last_24h} in the last 24 h` : ""} accent={data?.match_errors.total ? "#f2a594" : undefined} />
        </div>
      </HeaderBand>

      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p> : !data ? <p style={{ color: R.mute }}>Loading report…</p> : (
        <>
          <Panel title="Per rep" sub={`Dials = recordings of lead numbers · ${LIKELY_LABEL}`}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead><tr>
                  <th style={thStyle}>Rep</th><th style={thStyle}>Dials</th><th style={thStyle}>Forms</th>
                  <th style={{ ...thStyle, whiteSpace: "normal", minWidth: 150 }}>{LIKELY_LABEL}</th>
                  {CODES.map((c) => <th key={c.code} style={{ ...thStyle, textAlign: "center" }} title={c.label}><CodeChip code={c.code} /></th>)}
                  <th style={thStyle}>Conversions</th>
                </tr></thead>
                <tbody>{data.reps.map((r) => (
                  <tr key={r.id} className="crm-row">
                    <td style={tdStyle}><div style={{ display: "flex", gap: 10, alignItems: "center" }}><Avatar name={r.name} size={30} /><div><b>{r.name}</b><div style={{ fontSize: 11.5, color: R.mute }}>#{r.employee_code}</div></div></div></td>
                    <td style={tdStyle}>{r.dials}</td><td style={tdStyle}><b>{r.forms}</b></td><td style={tdStyle}>{r.likely}</td>
                    {CODES.map((c) => <td key={c.code} style={{ ...tdStyle, textAlign: "center", color: r[c.code] ? R.ink : "#cdbba1" }}>{r[c.code] || "·"}</td>)}
                    <td style={tdStyle}><b style={{ color: r.F ? R.good : R.mute }}>{r.F}</b>{r.forms ? <span style={{ color: R.mute, fontSize: 12 }}> · {pct(r.F / r.forms)}</span> : null}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </Panel>

          <div style={grid2}>
            <Panel title="Code funnel" sub="Distinct leads reaching each stage in this period"><CodeFunnel f={data.funnel} /></Panel>
            <Panel title="Why not? Z reasons" sub="Leads closed as not interested"><ReasonBars rows={data.reasons.z} color={R.bad} /></Panel>
          </div>
          <div style={grid2}>
            <Panel title="Callbacks: D / E reasons" sub="Why students asked to be called later"><ReasonBars rows={data.reasons.de} color={R.gold} /></Panel>
            <Panel title="Code vs call check" sub="A rep's code that disagrees with the automatic short-call check">
              <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}><Tag tone="gold">Preview data</Tag><PendingTag /></div>
              {data.call_check_mode === "off" ? <Empty>Call check is switched off in CRM Settings.</Empty>
                : !data.contradictions.length ? <Empty>No contradictions in this period.</Empty>
                : <List rows={data.contradictions.map((c) => ({
                    key: c.id, lead: c, onOpen: setOpen,
                    main: <><CodeChip code={c.code} /> saved, call check heard <b>{CHECK_LABEL[c.check_label]}</b> ({dur(c.duration_secs)}, {Math.round(c.confidence * 100)}%)</>,
                    sub: `${c.rep ?? "—"} · ${fmtWhen(c.created_at)}`,
                  }))} />}
            </Panel>
          </div>

          <h2 style={{ margin: "8px 2px 0", fontSize: 17, fontWeight: 800 }}>Mismatches</h2>
          <div style={grid2}>
            <Panel title="Forms without a recording" sub="Saved, but no KoreCall recording of that number by that rep within ±30 min (yet)">
              {!mm!.forms_without_recording.length ? <Empty>Every form has its recording.</Empty> : <List rows={mm!.forms_without_recording.map((f) => ({
                key: f.id, lead: f, onOpen: setOpen,
                main: <><CodeChip code={f.code} /> {codeMeta(f.code)?.label}{f.reason ? ` · ${f.reason}` : ""}</>,
                sub: `${f.rep ?? "—"} · ${fmtWhen(f.created_at)} · ${groupPhone(f.phone10)}`,
              }))} />}
            </Panel>
            <Panel title="Recordings without a form" sub="Calls to lead numbers that nobody filled a form for (other numbers are not flagged)">
              {!mm!.recordings_without_form.length ? <Empty>Every lead call has a form.</Empty> : <List rows={mm!.recordings_without_form.map((c) => ({
                key: c.id, lead: c, onOpen: setOpen,
                main: <>☎ {dur(c.duration_secs)} call to {groupPhone(c.phone10)}</>,
                sub: `${c.rep ?? "—"} · ${fmtWhen(c.called_at)}`,
              }))} />}
            </Panel>
          </div>
          <Panel title="Probable typos" sub="An unlinked form and an unlinked call by the same rep within 30 min, numbers one digit or one swap apart. Never merged automatically.">
            <div style={{ marginBottom: 8 }}><Tag tone="gold">Preview, v2</Tag></div>
            {!mm!.probable_typos.length ? <Empty>No probable typos.</Empty> : <TypoList rows={mm!.probable_typos} onOpen={setOpen} onLinked={() => mutate()} />}
          </Panel>

          {data.match_errors.total > 0 && (
            <Panel title="Matching errors" sub="The recording was saved, but linking it to a form failed. Logged by the database trigger.">
              <List rows={(data.match_errors.latest ?? []).map((e, i) => ({ key: String(i), main: <code style={{ fontSize: 12 }}>{e.error}</code>, sub: `${fmtWhen(e.created_at)} · call ${e.call_id?.slice(0, 8) ?? "—"}` }))} />
            </Panel>
          )}

          <DigestPreview />
        </>
      )}
      <LeadDrawer leadId={open} isOwner={isOwner} onClose={() => { setOpen(null); mutate(); }} onSaved={() => mutate()} />
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, color: R.mute, fontSize: 13 }}>{children}</p>;
}

function List({ rows }: { rows: { key: string; main: ReactNode; sub: string; lead?: Mini; onOpen?: (id: string) => void; action?: ReactNode }[] }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 0, maxHeight: 360, overflowY: "auto" }}>
      {rows.map((r) => (
        <li key={r.key} className="crm-row" style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 6px", borderTop: "1px solid #f1e8da" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {r.lead && <button onClick={() => r.onOpen?.(r.lead!.lead_id)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, color: R.ink, textDecoration: "underline", textDecorationColor: R.line }}>
                {r.lead.lead_code} {r.lead.lead_name}</button>}
              {r.main}
            </div>
            <div style={{ fontSize: 12, color: R.mute }}>{r.sub}</div>
          </div>
          {r.action}
        </li>
      ))}
    </ul>
  );
}

function TypoList({ rows, onOpen, onLinked }: { rows: Report["mismatches"]["probable_typos"]; onOpen: (id: string) => void; onLinked: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const link = async (r: Report["mismatches"]["probable_typos"][number]) => {
    setBusy(r.call_id);
    setErr("");
    try { await api.post("/crm/mismatches/link", { interaction_id: r.interaction_id, call_id: r.call_id }); onLinked(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };
  const diff = (a: string, b: string) => b.split("").map((ch, i) => <span key={i} style={ch !== a[i] ? { background: "#f8e3df", color: R.bad, fontWeight: 800, borderRadius: 3 } : undefined}>{ch}</span>);
  return (
    <>
      {err && <p role="alert" style={{ color: R.bad, fontSize: 13 }}>{err}</p>}
      <List rows={rows.map((r) => ({
        key: `${r.interaction_id}-${r.call_id}`, lead: r, onOpen,
        main: <span style={{ fontVariantNumeric: "tabular-nums" }}>form {r.form_phone} ↔ call {diff(r.form_phone, r.call_phone)}</span>,
        sub: `${r.rep ?? "—"} · form ${fmtWhen(r.created_at)} · call ${fmtWhen(r.called_at)} (${dur(r.duration_secs)})`,
        action: <Btn kind="ghost" onClick={() => link(r)} disabled={busy === r.call_id}>{busy === r.call_id ? "Linking…" : "Link these?"}</Btn>,
      }))} />
    </>
  );
}

function CodeFunnel({ f }: { f: Report["funnel"] }) {
  const stages: [string, number, string][] = [
    ["Worked", f.worked, "any form saved"], ["Connected", f.connected, "C, D, E, F or Z"], ["Talked", f.talked, "D, E, F or Z"],
    ["Interested", f.interested, "E or F"], ["Paid", f.paid, "F · ₹299 trial"],
  ];
  const top = f.worked || 1;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {stages.map(([label, v, sub], i) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div title={`${label}: ${v}`} style={{ width: `max(52px, ${(v / top) * 100}%)`, background: i === 4 ? R.good : R.ramp[[0, 2, 4, 5][i] ?? 6], color: i >= 2 ? "#fff" : R.ink,
              textAlign: "center", fontWeight: 800, fontSize: 13, padding: "8px 4px", borderRadius: 6, transition: "width .3s" }}>{v}</div>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.3 }}><b>{label}</b><div style={{ color: R.mute, fontSize: 11.5 }}>{pct(v / top)} · {sub}</div></div>
        </div>
      ))}
    </div>
  );
}

function ReasonBars({ rows, color }: { rows: { reason: string; n: number; share: number }[]; color: string }) {
  if (!rows.length) return <Empty>None in this period.</Empty>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((r) => (
        <div key={r.reason} style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr) 70px", gap: 10, alignItems: "center", fontSize: 13 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason}>{r.reason}</span>
          <div style={{ background: R.soft, borderRadius: 5, height: 14 }}><div style={{ width: `${r.share * 100}%`, background: color, height: "100%", borderRadius: 5, transition: "width .3s" }} /></div>
          <span style={{ textAlign: "right" }}><b>{pct(r.share)}</b> <span style={{ color: R.mute }}>({r.n})</span></span>
        </div>
      ))}
    </div>
  );
}

function DigestPreview() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [date, setDate] = useState(today);
  const { data: html } = useSWR(`/crm/digest/preview?date=${date}`, (p: string) => api.getText(p));
  return (
    <Panel title="F digest preview" sub="The end-of-day email to the owner: every paid trial, flagged when no recording is matched. Send time is a CRM setting.">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <label style={{ fontSize: 13 }}>Day <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} style={{ marginLeft: 6, border: `1px solid ${R.line}`, borderRadius: 8, padding: "5px 8px", fontFamily: "inherit" }} /></label>
      </div>
      {html ? <iframe title="F digest email preview" srcDoc={html} sandbox="" style={{ width: "100%", height: 560, border: `1px solid ${R.line}`, borderRadius: 12, background: R.page }} />
        : <Empty>Loading preview…</Empty>}
    </Panel>
  );
}
