"use client";

// CRM Reports (owner or view_crm_reports). Picture-first: Overview, Team, Reasons as charts;
// everything that needs checking (mismatches, typos, code-vs-check, matching errors) lives in
// its own Checks tab; the daily paid digest preview has its own tab too.
import { useState, type CSSProperties, type ReactNode } from "react";
import useSWR from "swr";
import { Avatar, Donut, HourLine, Panel, R, Ring, dur, hr, pct } from "@/components/report/kit";
import PeriodSelect from "@/components/ui/PeriodSelect";
import { usePeriodRange } from "@/hooks/usePeriodRange";
import { useAuth } from "@/hooks/useAuth";
import { useCrmMe } from "@/hooks/useCrmMe";
import { api, fetcher } from "@/lib/api";
import { CHECK_LABEL, CODES, LIKELY_LABEL, fmtWhen, groupPhone, type Code } from "@/lib/crm";
import { BandTile, Btn, CRM_CSS, CodeChip, HeaderBand, PendingTag, Tag, tabBtn, tdStyle, thStyle } from "@/components/crm/kit";
import LeadDrawer from "@/components/crm/LeadDrawer";

type Rep = { id: string; name: string; employee_code: number; dials: number; forms: number; likely: number } & Record<Code, number>;
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
  hours: { hours: number[]; forms: number[]; talked: number[]; paid: number[] };
};

// One colour per outcome: retries in warm greys, callbacks in golds, paid green, closed red
const CODE_COLOR: Record<Code, string> = { A: "#cdbba1", B: "#a99378", C: "#7f6a54", D: "#e3b778", E: "#c4862d", F: "#3f7a3a", Z: "#b33a2e" };
const TABS = ["overview", "team", "reasons", "checks", "digest"] as const;
type Tab = (typeof TABS)[number];
const grid = (cols: string): CSSProperties => ({ display: "grid", gridTemplateColumns: cols, gap: 14, alignItems: "start" });
const PAGE_CSS = `
  .cr-3{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr) minmax(0,1fr);gap:14px;align-items:stretch}
  .cr-2{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:14px;align-items:start}
  .cr-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
  .cr-seg{transition:filter .15s}.cr-seg:hover{filter:brightness(1.12)}
  @media (max-width:1100px){.cr-3,.cr-2{grid-template-columns:1fr}}
`;

export default function CrmReportsPage() {
  const { can, loaded } = useCrmMe();
  const { isOwner } = useAuth();
  const { params, selectProps } = usePeriodRange();
  const allowed = can("view_crm_reports");
  const { data, error, mutate } = useSWR<Report>(allowed ? `/crm/reports?${params}` : null, fetcher);
  const [tab, setTab] = useState<Tab>("overview");
  const [open, setOpen] = useState<string | null>(null);

  if (loaded && !allowed) return <p style={{ color: R.mute, padding: 8 }}>CRM Reports need the "View CRM reports" permission. Ask the owner.</p>;
  const t = data ? totals(data) : null;
  const checks = data ? data.mismatches.forms_without_recording.length + data.mismatches.recordings_without_form.length
    + data.mismatches.probable_typos.length + data.contradictions.length + (data.match_errors.total ? 1 : 0) : 0;
  const label: Record<Tab, ReactNode> = {
    overview: "Overview", team: "Team", reasons: "Reasons",
    checks: <>Checks {checks > 0 && <span style={{ background: R.bad, color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "1px 7px" }}>{checks}</span>}</>,
    digest: "Paid digest",
  };

  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gap: 14 }}>
      <style>{CRM_CSS + PAGE_CSS}</style>
      <HeaderBand eyebrow="CRM" title="CRM Reports" sub="How the team worked the leads" right={<PeriodSelect {...selectProps} />}>
        <div className="crm-g5">
          <BandTile label="Forms saved" value={t ? t.forms : "—"} sub="calls logged by reps" />
          <BandTile label="Likely conversations" value={t ? t.likely : "—"} sub="≥30 s, coded D/E/F/Z" />
          <BandTile label="Paid trials" value={t ? t.paid : "—"} sub={t ? `₹${t.paid * 299}` : ""} accent="#a9d39b" />
          <BandTile label="Conversion" value={t ? pct(t.forms ? t.paid / t.forms : 0) : "—"} sub="paid ÷ forms" accent="#a9d39b" />
          <button onClick={() => setTab("checks")} style={{ all: "unset", cursor: "pointer", display: "block" }} aria-label="Open Checks">
            <BandTile label="Needs checking" value={data ? checks : "—"} sub="open the Checks tab →" accent={checks ? "#f2a594" : undefined} />
          </button>
        </div>
        <nav aria-label="Report sections" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {TABS.map((k) => <button key={k} style={tabBtn(tab === k)} onClick={() => setTab(k)} aria-current={tab === k}>{label[k]}</button>)}
        </nav>
      </HeaderBand>

      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p> : !data || !t ? <p style={{ color: R.mute }}>Loading report…</p>
        : tab === "overview" ? <Overview data={data} t={t} goChecks={() => setTab("checks")} />
        : tab === "team" ? <Team data={data} />
        : tab === "reasons" ? <Reasons data={data} />
        : tab === "checks" ? <Checks data={data} onOpen={setOpen} onLinked={() => mutate()} />
        : <DigestPreview />}
      <LeadDrawer leadId={open} isOwner={isOwner} onClose={() => { setOpen(null); mutate(); }} onSaved={() => mutate()} />
    </div>
  );
}

function totals(d: Report) {
  const codes = Object.fromEntries(CODES.map((c) => [c.code, d.reps.reduce((a, r) => a + (r[c.code] ?? 0), 0)])) as Record<Code, number>;
  const forms = d.reps.reduce((a, r) => a + r.forms, 0);
  return { codes, forms, likely: d.reps.reduce((a, r) => a + r.likely, 0), paid: codes.F, dials: d.reps.reduce((a, r) => a + r.dials, 0) };
}
type Totals = ReturnType<typeof totals>;

function Empty({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, color: R.mute, fontSize: 13 }}>{children}</p>;
}

// ── Overview ──────────────────────────────────────────────────────────────

function Overview({ data, t, goChecks }: { data: Report; t: Totals; goChecks: () => void }) {
  if (!t.forms) return <Panel title="No forms saved in this period"><Empty>Pick another period above.</Empty></Panel>;
  const slices = CODES.map((c) => ({ label: `${c.code} · ${c.label}`, value: t.codes[c.code], color: CODE_COLOR[c.code] }));
  const top = [...data.reps].sort((a, b) => b.F - a.F || b.likely - a.likely)[0];
  const talker = [...data.reps].sort((a, b) => b.likely - a.likely)[0];
  const peak = data.hours.forms.indexOf(Math.max(...data.hours.forms));
  const z = data.reasons.z[0];
  const highlights: [string, ReactNode][] = [
    ["Top closer", top?.F ? <><b>{top.name}</b> · {top.F} paid</> : "No paid trials yet"],
    ["Most conversations", talker?.likely ? <><b>{talker.name}</b> · {talker.likely}</> : "—"],
    ["Busiest hour", data.hours.forms[peak] ? <><b>{hr(data.hours.hours[peak])}–{hr(data.hours.hours[peak] + 1)}</b> · {data.hours.forms[peak]} forms</> : "—"],
    ["Top reason for no", z ? <><b>{z.reason}</b> · {pct(z.share)}</> : "—"],
  ];
  return (
    <>
      <div className="cr-3">
        <Panel title="Outcome mix" sub="What happened on every saved call">
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <Donut slices={slices} size={150} center={t.forms} sub="forms" />
            <div style={{ display: "grid", gap: 5, fontSize: 12.5, flex: "1 1 130px" }}>
              {CODES.map((c) => (
                <span key={c.code} style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <i style={{ width: 10, height: 10, borderRadius: 3, background: CODE_COLOR[c.code], flex: "none" }} />
                  <b style={{ width: 12 }}>{c.code}</b><span style={{ color: R.mute, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                  <b>{t.codes[c.code]}</b>
                </span>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Lead funnel" sub="Distinct leads reaching each stage"><CodeFunnel f={data.funnel} /></Panel>
        <section style={{ background: "linear-gradient(160deg,#3b2a1e,#5a4231 75%,#6f4f35)", color: "#fff", borderRadius: 14, padding: 16, display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: R.gold, fontWeight: 700 }}>Highlights</div>
          {highlights.map(([k, v]) => (
            <div key={k} style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 11, padding: "9px 12px" }}>
              <div style={{ fontSize: 11, color: "#e9dccb", opacity: 0.85 }}>{k}</div>
              <div style={{ fontSize: 14, marginTop: 2 }}>{v}</div>
            </div>
          ))}
          <Btn kind="light" onClick={goChecks}>Review the checks →</Btn>
        </section>
      </div>
      <div className="cr-2">
        <Panel title="Calls logged through the day" sub="Forms saved per hour, all reps · hover an hour"><HourLine hours={data.hours.hours} values={data.hours.forms} /></Panel>
        <Panel title="Who's doing what" sub="Each rep's saved calls, split by outcome · hover a block"><RepStacks reps={data.reps} /></Panel>
      </div>
    </>
  );
}

function RepStacks({ reps }: { reps: Rep[] }) {
  const max = Math.max(1, ...reps.map((r) => r.forms));
  const sorted = [...reps].sort((a, b) => b.forms - a.forms);
  return (
    <div style={{ display: "grid", gap: 9 }}>
      {sorted.map((r) => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) 56px", gap: 10, alignItems: "center" }}>
          <span style={{ display: "flex", gap: 7, alignItems: "center", minWidth: 0 }}><Avatar name={r.name} size={24} />
            <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name.split(" ")[0]}</span></span>
          <div style={{ display: "flex", height: 18, width: `${Math.max(4, (r.forms / max) * 100)}%`, borderRadius: 5, overflow: "hidden", background: R.soft, transition: "width .3s" }}>
            {CODES.map((c) => r[c.code] ? <span key={c.code} className="cr-seg" title={`${r.name} · ${c.code} ${c.label}: ${r[c.code]}`}
              style={{ flex: r[c.code], background: CODE_COLOR[c.code], borderRight: "1px solid #fffdf8" }} /> : null)}
          </div>
          <span style={{ fontSize: 12, textAlign: "right" }}><b>{r.forms}</b>{r.F ? <span style={{ color: R.good, fontWeight: 800 }}> · {r.F}F</span> : null}</span>
        </div>
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 11.5, color: R.mute, marginTop: 4 }}>
        {CODES.map((c) => <span key={c.code}><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: CODE_COLOR[c.code], marginRight: 5 }} />{c.code}</span>)}
      </div>
    </div>
  );
}

function CodeFunnel({ f }: { f: Report["funnel"] }) {
  const stages: [string, number, string][] = [
    ["Worked", f.worked, "any form"], ["Connected", f.connected, "C–Z"], ["Talked", f.talked, "D–Z"], ["Interested", f.interested, "E or F"], ["Paid", f.paid, "F"],
  ];
  const top = f.worked || 1;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {stages.map(([label, v, sub], i) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div title={`${label}: ${v}`} style={{ width: `max(48px, ${(v / top) * 100}%)`, background: i === 4 ? R.good : R.ramp[[0, 2, 4, 5][i] ?? 6], color: i >= 2 ? "#fff" : R.ink,
              textAlign: "center", fontWeight: 800, fontSize: 13, padding: "7px 4px", borderRadius: 6, transition: "width .3s" }}>{v}</div>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.25 }}><b>{label}</b><div style={{ color: R.mute, fontSize: 11 }}>{pct(v / top)} · {sub}</div></div>
        </div>
      ))}
    </div>
  );
}

// ── Team ──────────────────────────────────────────────────────────────────

function Team({ data }: { data: Report }) {
  const [table, setTable] = useState(false);
  const reps = [...data.reps].sort((a, b) => b.F - a.F || b.forms - a.forms);
  return (
    <>
      <div className="cr-cards">
        {reps.map((r, i) => {
          const conv = r.forms ? r.F / r.forms : 0;
          return (
            <section key={r.id} style={{ background: R.card, border: `1px solid ${i === 0 && r.F ? R.gold : R.line}`, borderRadius: 14, padding: 14, display: "grid", gap: 10, position: "relative" }}>
              {i === 0 && r.F > 0 && <span style={{ position: "absolute", top: 10, right: 12 }}><Tag tone="gold">★ Top closer</Tag></span>}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}><Avatar name={r.name} size={38} />
                <div><b style={{ fontSize: 14.5 }}>{r.name}</b><div style={{ fontSize: 11.5, color: R.mute }}>#{r.employee_code}</div></div></div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Ring frac={conv} size={78} color={conv ? R.good : "#cdbba1"} label={pct(conv)} />
                <div style={{ display: "grid", gap: 4, fontSize: 12.5, flex: 1 }}>
                  {[["Dials", r.dials], ["Forms", r.forms], ["Talked ≥30 s", r.likely], ["Paid", r.F]].map(([k, v]) => (
                    <div key={k as string} style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: R.mute }}>{k}</span><b>{v}</b></div>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: R.soft }} aria-label="Outcome split">
                {CODES.map((c) => r[c.code] ? <span key={c.code} title={`${c.code} ${c.label}: ${r[c.code]}`} style={{ flex: r[c.code], background: CODE_COLOR[c.code] }} /> : null)}
              </div>
            </section>
          );
        })}
      </div>
      <div><Btn kind="ghost" onClick={() => setTable((x) => !x)}>{table ? "Hide the full table" : "Show the full table"}</Btn></div>
      {table && (
        <Panel title="Per rep, in numbers" sub={LIKELY_LABEL}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead><tr>
                <th style={thStyle}>Rep</th><th style={thStyle}>Dials</th><th style={thStyle}>Forms</th><th style={{ ...thStyle, whiteSpace: "normal" }}>{LIKELY_LABEL}</th>
                {CODES.map((c) => <th key={c.code} style={{ ...thStyle, textAlign: "center" }}><CodeChip code={c.code} /></th>)}
              </tr></thead>
              <tbody>{reps.map((r) => (
                <tr key={r.id} className="crm-row">
                  <td style={tdStyle}><b>{r.name}</b></td><td style={tdStyle}>{r.dials}</td><td style={tdStyle}>{r.forms}</td><td style={tdStyle}>{r.likely}</td>
                  {CODES.map((c) => <td key={c.code} style={{ ...tdStyle, textAlign: "center", color: r[c.code] ? R.ink : "#cdbba1" }}>{r[c.code] || "·"}</td>)}
                </tr>))}</tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

// ── Reasons ───────────────────────────────────────────────────────────────

const Z_COLORS = ["#b33a2e", "#cf6a4f", "#e39a7a", "#efc3ae", "#7f6a54", "#a99378"];
const DE_COLORS = ["#c4862d", "#e3b778", "#a8641f", "#f0d4a2", "#8c5a3c", "#d9c3a3"];

function ReasonPanel({ title, rows, colors, center }: { title: string; rows: Report["reasons"]["z"]; colors: string[]; center: string }) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  return (
    <Panel title={title} sub={total ? `${total} saved calls` : undefined}>
      {!rows.length ? <Empty>None in this period.</Empty> : (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <Donut slices={rows.map((r, i) => ({ label: r.reason, value: r.n, color: colors[i % colors.length] }))} size={150} center={total} sub={center} />
            <div style={{ flex: "1 1 160px", textAlign: "center", padding: 10, background: R.soft, borderRadius: 12 }}>
              <div style={{ fontSize: 11, color: R.mute, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Most common</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: colors[0] }}>{pct(rows[0].share)}</div>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{rows[0].reason}</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 7 }}>
            {rows.map((r, i) => (
              <div key={r.reason} style={{ display: "grid", gridTemplateColumns: "160px minmax(0,1fr) 54px", gap: 10, alignItems: "center", fontSize: 12.5 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason}>{r.reason}</span>
                <div style={{ background: R.soft, borderRadius: 5, height: 12 }}><div style={{ width: `${r.share * 100}%`, background: colors[i % colors.length], height: "100%", borderRadius: 5, transition: "width .3s" }} /></div>
                <b style={{ textAlign: "right" }}>{pct(r.share)}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Reasons({ data }: { data: Report }) {
  return (
    <div style={grid("repeat(auto-fit,minmax(420px,1fr))")}>
      <ReasonPanel title="Why students said no (Z)" rows={data.reasons.z} colors={Z_COLORS} center="said no" />
      <ReasonPanel title="Why they asked for a callback (D / E)" rows={data.reasons.de} colors={DE_COLORS} center="callbacks" />
    </div>
  );
}

// ── Checks ────────────────────────────────────────────────────────────────

function List({ rows }: { rows: { key: string; main: ReactNode; sub: string; lead?: Mini; onOpen?: (id: string) => void; action?: ReactNode }[] }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 340, overflowY: "auto" }}>
      {rows.map((r) => (
        <li key={r.key} className="crm-row" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 6px", borderTop: "1px solid #f1e8da" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {r.lead && <button onClick={() => r.onOpen?.(r.lead!.lead_id)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, color: R.ink, textDecoration: "underline", textDecorationColor: R.line }}>
                {r.lead.lead_name}</button>}
              {r.main}
            </div>
            <div style={{ fontSize: 11.5, color: R.mute }}>{r.sub}</div>
          </div>
          {r.action}
        </li>
      ))}
    </ul>
  );
}

function CheckTile({ n, label, tone, onClick }: { n: number; label: string; tone: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="crm-btn" style={{ textAlign: "left", fontFamily: "inherit", cursor: "pointer", background: R.card, border: `1px solid ${R.line}`, borderTop: `4px solid ${n ? tone : "#d9c9b1"}`, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: n ? tone : R.mute }}>{n}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: R.ink }}>{label}</div>
    </button>
  );
}

function Checks({ data, onOpen, onLinked }: { data: Report; onOpen: (id: string) => void; onLinked: () => void }) {
  const mm = data.mismatches;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <>
      <div style={grid("repeat(auto-fit,minmax(170px,1fr))")}>
        <CheckTile n={mm.forms_without_recording.length} label="Forms with no recording" tone={R.out} onClick={() => go("ck-forms")} />
        <CheckTile n={mm.recordings_without_form.length} label="Recordings with no form" tone={R.out} onClick={() => go("ck-recs")} />
        <CheckTile n={mm.probable_typos.length} label="Probable number typos" tone={R.gold} onClick={() => go("ck-typos")} />
        <CheckTile n={data.contradictions.length} label="Code vs call check" tone={R.bad} onClick={() => go("ck-check")} />
        <CheckTile n={data.match_errors.total} label="Matching errors" tone={R.bad} onClick={() => go("ck-errors")} />
      </div>
      <div style={grid("repeat(auto-fit,minmax(420px,1fr))")}>
        <div id="ck-forms"><Panel title={`Forms with no recording · ${mm.forms_without_recording.length}`} sub="No KoreCall recording of that number by that rep within ±30 min (yet)">
          {!mm.forms_without_recording.length ? <Empty>All matched ✓</Empty> : <List rows={mm.forms_without_recording.map((f) => ({
            key: f.id, lead: f, onOpen, main: <CodeChip code={f.code} />, sub: `${f.rep ?? "—"} · ${fmtWhen(f.created_at)} · ${groupPhone(f.phone10)}`,
          }))} />}
        </Panel></div>
        <div id="ck-recs"><Panel title={`Recordings with no form · ${mm.recordings_without_form.length}`} sub="Calls to lead numbers nobody filled a form for">
          {!mm.recordings_without_form.length ? <Empty>All matched ✓</Empty> : <List rows={mm.recordings_without_form.map((c) => ({
            key: c.id, lead: c, onOpen, main: <Tag>☎ {dur(c.duration_secs)}</Tag>, sub: `${c.rep ?? "—"} · ${fmtWhen(c.called_at)} · ${groupPhone(c.phone10)}`,
          }))} />}
        </Panel></div>
      </div>
      <div id="ck-typos"><Panel title={`Probable number typos · ${mm.probable_typos.length}`} sub="Same rep, within 30 min, numbers one digit or one swap apart. Never merged automatically.">
        <div style={{ marginBottom: 6 }}><Tag tone="gold">Preview, v2</Tag></div>
        {!mm.probable_typos.length ? <Empty>None ✓</Empty> : <TypoList rows={mm.probable_typos} onOpen={onOpen} onLinked={onLinked} />}
      </Panel></div>
      <div style={grid("repeat(auto-fit,minmax(420px,1fr))")}>
        <div id="ck-check"><Panel title={`Code vs call check · ${data.contradictions.length}`} sub="The rep's code disagrees with the automatic short-call check">
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}><Tag tone="gold">Preview data</Tag><PendingTag /></div>
          {data.call_check_mode === "off" ? <Empty>Call check is off in CRM Settings.</Empty>
            : !data.contradictions.length ? <Empty>None ✓</Empty>
            : <List rows={data.contradictions.map((c) => ({
                key: c.id, lead: c, onOpen,
                main: <><CodeChip code={c.code} /> <span style={{ color: R.mute }}>vs</span> <Tag tone="bad">{CHECK_LABEL[c.check_label]}</Tag></>,
                sub: `${c.rep ?? "—"} · ${fmtWhen(c.created_at)} · ${dur(c.duration_secs)} call`,
              }))} />}
        </Panel></div>
        <div id="ck-errors"><Panel title={`Matching errors · ${data.match_errors.total}`} sub="Recording saved, but linking it to a form failed (logged by the database)">
          {!data.match_errors.total ? <Empty>None ✓</Empty> : <List rows={(data.match_errors.latest ?? []).map((e, i) => ({
            key: String(i), main: <code style={{ fontSize: 12 }}>{e.error}</code>, sub: `${fmtWhen(e.created_at)} · call ${e.call_id?.slice(0, 8) ?? "—"}`,
          }))} />}
        </Panel></div>
      </div>
    </>
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
        main: <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12.5 }}>form {r.form_phone} → call {diff(r.form_phone, r.call_phone)}</span>,
        sub: `${r.rep ?? "—"} · ${fmtWhen(r.created_at)}`,
        action: <Btn kind="ghost" onClick={() => link(r)} disabled={busy === r.call_id}>{busy === r.call_id ? "Linking…" : "Link these?"}</Btn>,
      }))} />
    </>
  );
}

// ── Paid digest ───────────────────────────────────────────────────────────

function DigestPreview() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [date, setDate] = useState(today);
  const { data: html } = useSWR(`/crm/digest/preview?date=${date}`, (p: string) => api.getText(p));
  return (
    <Panel title="Daily paid digest (email preview)" sub="Sent to the owner at the end of the day; flags a paid trial with no matched recording">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <label style={{ fontSize: 13 }}>Day <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} style={{ marginLeft: 6, border: `1px solid ${R.line}`, borderRadius: 8, padding: "5px 8px", fontFamily: "inherit" }} /></label>
      </div>
      {html ? <iframe title="Paid digest email preview" srcDoc={html} sandbox="" style={{ width: "100%", height: 560, border: `1px solid ${R.line}`, borderRadius: 12, background: R.page }} />
        : <Empty>Loading preview…</Empty>}
    </Panel>
  );
}

