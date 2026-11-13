"use client";

// Report dashboard: the emailed report as live pages — Overview, Team and one page per person —
// with its own section rail, period picker and PDF download. Figures come from /reports/data,
// which uses the same calculation as the email and PDF.
import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { usePeriodRange } from "@/hooks/usePeriodRange";
import { useAuth } from "@/hooks/useAuth";
import { Icon } from "@/components/crm/icons";
import PeriodSelect from "@/components/ui/PeriodSelect";
import type { ReportData, ReportPerson, TeamsResponse } from "@callflow/shared-types";
import {
  Avatar, BUCKETS, Donut, Funnel, HourLine, LengthColumns, Legend, MIX, Panel, PeopleBars, Pill, R, Ring, dur, hr, pct,
} from "@/components/report/kit";

const CSS = `
  .rv{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
  .rv-rail{min-width:0}
  .rv-nav{display:flex;overflow-x:auto;gap:4px;align-items:center}
  .rv-nav button,.rv-nav .rv-idle{flex:none;white-space:nowrap}
  .rv-nav option{color:${R.ink};background:#fff}
  .rv-hl{display:grid;grid-template-columns:250px minmax(0,1fr);gap:18px;align-items:start}
  .rv-hl-list{columns:2;column-gap:28px}.rv-hl-list li{break-inside:avoid}
  .rv-g2{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:14px}
  .rv-gp{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .rv-g4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
  .rv-row:hover{background:${R.soft}}
  .rv-ins b{color:${R.gold}}
  @media (min-width:1700px){.rv{grid-template-columns:220px minmax(0,1fr);align-items:start}.rv-rail{position:sticky;top:16px}
    .rv-nav{display:grid;gap:2px}.rv-nav button,.rv-nav select{width:100%;max-width:none!important}}
  @media (max-width:1100px){.rv-hl-list{columns:1}}
  @media (max-width:900px){.rv-g2,.rv-gp,.rv-g4,.rv-hl{grid-template-columns:1fr 1fr}.rv-g2>*,.rv-hl>*{grid-column:span 2}}
  @media (max-width:600px){.rv-g2,.rv-gp,.rv-g4,.rv-hl{grid-template-columns:1fr}.rv-g2>*,.rv-hl>*{grid-column:auto}}
`;

const sectionBtn = (on: boolean): CSSProperties => ({
  display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "8px 12px", border: 0, borderRadius: 9,
  cursor: "pointer", fontSize: 13.5, fontFamily: "inherit", color: on ? "#fff" : "#e9dccb",
  background: on ? "#5a4231" : "transparent", boxShadow: on ? `inset 3px 0 0 ${R.gold}` : "none", fontWeight: on ? 600 : 400,
});
const tile = (bg: string): CSSProperties => ({ background: bg, color: "#fff", borderRadius: 14, padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 });
const tl: CSSProperties = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", opacity: 0.85, fontWeight: 600 };
const tv: CSSProperties = { fontSize: 28, fontWeight: 800, margin: "4px 0 2px" };
const ts: CSSProperties = { fontSize: 12, opacity: 0.85 };

export default function ReportViewPage() {
  const { params, selectProps } = usePeriodRange();
  // A User (the lowest rank) gets only their own report from the server, whatever is asked for
  const { can } = useAuth();
  const { data, error, isLoading } = useSWR<ReportData>(`/reports/data?employee_id=all&${params}`, fetcher);
  const [section, setSection] = useState("overview");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const people = data?.people ?? [];
  const showTeam = people.length > 1;
  // A person picked for one period may have no calls in the next: fall back to the overview
  const current = section === "overview" || (section === "team" && showTeam) || people.some((p) => p.code === section) ? section : "overview";
  const person = people.find((p) => p.code === current);

  const download = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      const url = URL.createObjectURL(await api.getBlob(`/reports/view?employee_id=${person?.id ?? "all"}&${params}&format=pdf`));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${person ? person.name : "Call Report"} - ${data?.period ?? ""}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{data?.title ?? "Call Report"}</h1>
          {data && <div style={{ fontSize: 13, color: R.mute, marginTop: 2 }}>{data.period}</div>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* The report opens first; the email schedules are one click away (client, 12 Nov) */}
          {can("reports") && (
            <Link href="/dashboard/reports" title="Set up reports that are emailed on a schedule"
              style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "#fff", border: `1px solid ${R.line}`, borderRadius: 12,
                padding: "8px 14px 8px 10px", textDecoration: "none", color: R.ink, boxShadow: "0 1px 2px rgba(43,33,24,.06)" }}>
              <span aria-hidden style={{ width: 30, height: 30, borderRadius: 9, background: "#fdf1e7", color: R.out, display: "inline-grid", placeItems: "center" }}><Icon name="mail" size={17} /></span>
              <span style={{ display: "grid", lineHeight: 1.2 }}>
                <b style={{ fontSize: 13.5 }}>Email schedules</b>
                <span style={{ fontSize: 11.5, color: R.mute }}>Send this report by email</span>
              </span>
            </Link>
          )}
          <PeriodSelect {...selectProps} />
          <button onClick={download} disabled={downloading || !data}
            style={{ background: R.out, color: "#fff", border: 0, borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer", opacity: downloading || !data ? 0.6 : 1 }}>
            {downloading ? "Preparing PDF…" : person ? `Download ${person.name.split(/\s+/)[0]}'s PDF` : "Download PDF"}
          </button>
        </div>
      </div>
      {downloadError && <p role="alert" style={{ color: R.bad, fontSize: 13 }}>{downloadError}</p>}

      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p>
        : isLoading || !data ? <p style={{ color: R.mute }}>Loading report…</p>
        : (
          <div className="rv">
            <aside className="rv-rail" style={{ background: R.espresso, borderRadius: 14, padding: 8, color: "#e9dccb" }}>
              <nav aria-label="Report sections" className="rv-nav">
                <button style={sectionBtn(current === "overview")} onClick={() => setSection("overview")} aria-current={current === "overview"}>Overview</button>
                {showTeam && <button style={sectionBtn(current === "team")} onClick={() => setSection("team")} aria-current={current === "team"}>Team</button>}
                {/* One People dropdown instead of a button per agent (client, 13 Nov) */}
                {(people.length > 0 || data.idle.length > 0) && (
                  <select aria-label="Pick an agent" value={person ? person.code : ""} onChange={(e) => e.target.value && setSection(e.target.value)}
                    style={{ ...sectionBtn(!!person), appearance: "auto", flex: "none", maxWidth: 260 }}>
                    <option value="" disabled>People</option>
                    {people.map((p) => <option key={p.code} value={p.code}>{p.name} · {p.calls} calls</option>)}
                    {data.idle.map((n) => <option key={n} value="" disabled>{n} · no calls</option>)}
                  </select>
                )}
              </nav>
            </aside>
            <main style={{ minWidth: 0, display: "grid", gap: 14 }}>
              {person ? <PersonPage p={person} data={data} solo={people.length === 1} />
                : current === "team" ? <TeamPage data={data} open={setSection} />
                : <OverviewPage data={data} open={setSection} />}
            </main>
          </div>
        )}
    </div>
  );
}

function Head({ eyebrow, title, right }: { eyebrow: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div><div style={{ color: R.out, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 11 }}>{eyebrow}</div>
        <h2 style={{ margin: "2px 0 0", fontSize: 21, fontWeight: 800 }}>{title}</h2></div>
      {right}
    </div>
  );
}

function OverviewPage({ data, open }: { data: ReportData; open: (s: string) => void }) {
  const t = data.team;
  if (!t.calls) return <Panel title="No calls were recorded in this period"><p style={{ margin: 0, color: R.mute }}>Pick another period above.</p></Panel>;
  const top = data.people.find((p) => p.code === data.top);
  const mix = MIX.map(([label, idx], i) => ({ label, value: idx.reduce((a, j) => a + t.b[j], 0), color: R.mix[i] }));
  return (
    <>
      <div className="rv-g4">
        <div style={{ ...tile("linear-gradient(150deg,#3b2a1e,#5a4231)"), display: "block" }}>
          <div style={tl}>Total calls</div><div style={tv}>{t.calls}</div>
          <div style={{ display: "flex", gap: 2, height: 8, borderRadius: 4, overflow: "hidden", marginTop: 6 }} title={`${t.inb} inbound · ${t.out} outbound`}>
            <div style={{ flex: t.inb, background: R.in }} /><div style={{ flex: t.out, background: R.out }} />
          </div>
          <div style={{ ...ts, display: "flex", justifyContent: "space-between", marginTop: 6 }}><span>{t.inb} inbound</span><span>{t.out} outbound</span></div>
        </div>
        <div style={tile("#c4622d")}><div><div style={tl}>Talk time</div><div style={tv}>{dur(t.dur)}</div><div style={ts}>avg {dur(t.avg)} per call</div></div></div>
        <div style={tile("#a8641f")}><div><div style={tl}>Invalid numbers</div><div style={tv}>{t.invalid}</div><div style={ts}>of {t.out} outbound</div></div>
          <Ring frac={t.out ? t.invalid / t.out : 0} size={66} color="#fff" track="rgba(255,255,255,.25)" ink="#fff" label={pct(t.invalid / t.out)} /></div>
        <div style={tile("#8c5a3c")}><div><div style={tl}>Active staff</div><div style={tv}>{data.people.length}/{data.people.length + data.idle.length}</div>
          <div style={ts}>{data.idle.length ? `No calls: ${data.idle.join(", ")}` : "Everyone made calls"}</div></div></div>
      </div>
      <section className="rv-hl" style={{ background: "linear-gradient(160deg,#3b2a1e,#5a4231 75%,#6f4f35)", color: "#fff", borderRadius: 14, padding: 16 }}>
        <button onClick={() => top && open(top.code)} disabled={!top}
          style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 12, padding: 14, color: "#fff", textAlign: "left", fontFamily: "inherit", cursor: top ? "pointer" : "default" }}>
          <div style={{ ...tl, color: R.gold, opacity: 1 }}>Top performer</div>
          {top ? <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}><Avatar name={top.name} size={42} />
            <div style={{ minWidth: 0 }}><b style={{ fontSize: 15 }}>{top.name}</b><div style={{ fontSize: 12, opacity: 0.8 }}>{dur(top.dur)} talk · {top.calls} calls →</div></div></div>
            : <div style={{ fontSize: 13, opacity: 0.8, marginTop: 10 }}>Not enough calls to rank</div>}
        </button>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ ...tl, color: R.gold, opacity: 1, margin: "2px 0 4px" }}>Highlights</h3>
          <ul className="rv-hl-list" style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13.5, lineHeight: 1.45 }}>
            {/* Server-built: only <b> tags, every name escaped */}
            {data.insights.map((h, i) => <li key={i} className="rv-ins" style={{ padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.12)" }} dangerouslySetInnerHTML={{ __html: h }} />)}
          </ul>
        </div>
      </section>
      <div className="rv-g2">
        <Panel title="Calls through the day" sub={`All staff · busiest ${t.peakHour !== null ? `${hr(t.peakHour)}–${hr(t.peakHour + 1)}` : "—"} · hover for each hour`}><HourLine hours={data.hours} values={t.hours} /></Panel>
        <Panel title="Call funnel" sub="From dialled to real conversation"><Funnel f={t.funnel} /></Panel>
      </div>
      <div className="rv-g2">
        <Panel title="Calls per person" sub="Inbound vs outbound · click a person to open their page">
          <PeopleBars people={data.people.map((p) => ({ key: p.code, name: p.name, inb: p.inb, out: p.out }))} onPick={open} />
          <Legend items={[[R.in, "Inbound"], [R.out, "Outbound"]]} />
        </Panel>
        <Panel title="Call length mix" sub="Hover a slice">
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <Donut slices={mix} size={150} center={t.calls} sub="calls" />
            <div style={{ display: "grid", gap: 6, fontSize: 13, flex: "1 1 130px", minWidth: 0 }}>
              {mix.map((m) => <span key={m.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <i style={{ width: 10, height: 10, borderRadius: 3, background: m.color, flex: "none" }} />{m.label}
                <b style={{ marginLeft: "auto" }}>{m.value}</b><span style={{ color: R.mute, width: 36, textAlign: "right" }}>{pct(m.value / t.calls)}</span></span>)}
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

type Group = { key: string; title: string; people: ReportPerson[]; idle: string[] };

/** The Team page split by the teams on the Teams tab (client, 13 Nov 2026); one "Staff" group when there are none. */
function useGroups(data: ReportData): Group[] {
  const { can } = useAuth();
  const { data: t } = useSWR<TeamsResponse>(can("teams") ? "/teams" : null, fetcher);
  if (!t?.teams.length) return [{ key: "all", title: "Staff", people: data.people, idle: data.idle }];
  const inTeam = (members: TeamsResponse["unassigned"]) => ({
    people: data.people.filter((p) => members.some((m) => m.id === p.id)),
    idle: data.idle.filter((n) => members.some((m) => m.name === n)),
  });
  const placed = new Set(t.teams.flatMap((x) => x.members.map((m) => m.id)));
  const placedNames = new Set(t.teams.flatMap((x) => x.members.map((m) => m.name)));
  return [
    ...t.teams.map((x) => ({ key: x.id, title: x.location ? `${x.name} · ${x.location}` : x.name, ...inTeam(x.members) })),
    // no team, or not on the Teams tab at all (e.g. a Super Admin who takes calls)
    { key: "none", title: "No team", people: data.people.filter((p) => !placed.has(p.id ?? "")), idle: data.idle.filter((n) => !placedNames.has(n)) },
  ].filter((g) => g.people.length || g.idle.length);
}

function TeamPage({ data, open }: { data: ReportData; open: (s: string) => void }) {
  const groups = useGroups(data);
  const { can } = useAuth();
  const split = groups.length > 1 || groups[0]?.key !== "all";
  const maxCell = Math.max(1, ...data.people.flatMap((p) => p.b));
  const th: CSSProperties = { textAlign: "left", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: R.mute, background: R.soft, padding: "9px 10px", fontWeight: 600 };
  const td: CSSProperties = { padding: "10px", borderBottom: "1px solid #f1e8da" };
  const groupHead: CSSProperties = { fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 700, color: R.out };
  const sum = (g: Group) => {
    const calls = g.people.reduce((n, p) => n + p.calls, 0), secs = g.people.reduce((n, p) => n + p.dur, 0);
    return `${g.people.length + g.idle.length} staff · ${calls} calls · ${dur(secs)} talk time${calls ? ` · avg ${dur(Math.round(secs / calls))}` : ""}`;
  };
  return (
    <>
      <Head eyebrow="Team" title="Team performance" />
      {/* the split needs teams: say where to make them instead of looking unchanged */}
      {!split && can("teams") && (
        <p style={{ margin: 0, fontSize: 13.5, color: R.mute, background: R.card, border: `1px dashed ${R.line}`, borderRadius: 12, padding: "10px 14px" }}>
          Set up teams on the <Link href="/dashboard/teams" style={{ color: R.out, fontWeight: 700 }}>Teams</Link> tab and this page splits by team.</p>
      )}
      {groups.map((g) => (
        <Panel key={g.key} title={g.title} sub={`${split ? `${sum(g)} · ` : ""}Sorted by talk time · click a row to open the person${g.idle.length ? ` · No calls: ${g.idle.join(", ")}` : ""}`}>
          {g.people.length === 0 ? <p style={{ margin: 0, color: R.mute, fontSize: 13.5 }}>No calls from this team in this period.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead><tr>{["Staff", "Calls", "In / Out", "Talk time", "Avg", "< 30s", "Invalid", "Status"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{g.people.map((p) => (
                <tr key={p.code} className="rv-row" onClick={() => open(p.code)} style={{ cursor: "pointer" }}>
                  <td style={td}><div style={{ display: "flex", gap: 10, alignItems: "center" }}><Avatar name={p.name} size={34} /><div><b>{p.name}</b><div style={{ fontSize: 11.5, color: R.mute }}>Line {p.line} · #{p.code}</div></div></div></td>
                  <td style={td}><b>{p.calls}</b></td><td style={td}>{p.inb} / {p.out}</td><td style={td}>{dur(p.dur)}</td><td style={td}>{dur(p.avg)}</td>
                  <td style={td}>{pct(p.short)}</td><td style={td}>{p.invalid}</td><td style={td}><Pill status={p.status} /></td>
                </tr>))}</tbody>
            </table>
          </div>)}
        </Panel>
      ))}
      <Panel title="Meaningful-call rate" sub="Share of each person's calls lasting 30 seconds or more">
        <div style={{ display: "grid", gap: 16 }}>
          {groups.filter((g) => g.people.length).map((g) => (
            <div key={g.key}>
              {split && <div style={{ ...groupHead, marginBottom: 8 }}>{g.title}</div>}
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: split ? "flex-start" : "space-around", gap: 14 }}>
                {g.people.map((p) => (
                  <button key={p.code} onClick={() => open(p.code)} style={{ background: "none", border: 0, cursor: "pointer", textAlign: "center", fontFamily: "inherit", color: R.ink }}>
                    <Ring frac={p.meaningful} color={p.status[1] === "neu" ? "#b9a68e" : p.meaningful < 0.5 ? R.bad : "#c4622d"} label={pct(p.meaningful)} />
                    <b style={{ display: "block", fontSize: 13 }}>{p.name}</b><span style={{ fontSize: 11.5, color: R.mute }}>{p.calls} calls</span>
                  </button>))}
              </div>
            </div>))}
        </div>
      </Panel>
      <Panel title="Call length heatmap" sub="Calls in each length band · darker = more calls · hover a cell">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 3, fontSize: 12.5 }}>
            <thead><tr><th />{BUCKETS.map((b) => <th key={b} style={{ fontSize: 10.5, color: R.mute, fontWeight: 600, textTransform: "uppercase", padding: 4 }}>{b}</th>)}</tr></thead>
            {groups.filter((g) => g.people.length).map((g) => (
              <tbody key={g.key}>
                {split && <tr><td colSpan={BUCKETS.length + 1} style={{ ...groupHead, padding: "10px 0 2px" }}>{g.title}</td></tr>}
                {g.people.map((p) => (
                  <tr key={p.code}><td style={{ fontWeight: 600, whiteSpace: "nowrap", paddingRight: 8 }}>{p.name}</td>
                    {p.b.map((v, i) => { const k = Math.min(7, Math.floor((v / maxCell) * 7.999)); return (
                      <td key={i} title={`${p.name} · ${BUCKETS[i]}: ${v} calls`} style={{ textAlign: "center", padding: "9px 4px", borderRadius: 6, fontWeight: 700, background: v ? R.heat[k] : R.soft, color: v ? (k >= 3 ? "#fff" : R.ink) : "#cdbba1" }}>{v || "·"}</td>); })}
                  </tr>))}
              </tbody>))}
          </table>
        </div>
      </Panel>
    </>
  );
}

function PersonPage({ p, data, solo }: { p: ReportPerson; data: ReportData; solo: boolean }) {
  const t = data.team;
  const kpis: [string, string | number, string, string][] = [
    ["Calls", p.calls, `${p.inb} in · ${p.out} out`, "#c4622d"],
    ["Talk time", dur(p.dur), solo ? `${pct(p.meaningful)} of calls 30s+` : `${pct(p.dur / t.dur)} of team`, "#a8641f"],
    ["Avg call", dur(p.avg), solo ? `${p.lt10} under 10s` : `team ${dur(t.avg)}`, "#8c5a3c"],
    ["Invalid nos.", p.invalid, `${pct(p.invPct)} of outbound`, "#5b4636"],
  ];
  const gap = (label: string, v: number | null, note: string) => (
    <div style={{ border: "1.5px dashed #d8c9b3", background: R.card, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ fontSize: 12, color: R.mute, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 2px" }}>{dur(v)}</div>
      <div style={{ fontSize: 12, color: R.mute }}>{note}</div>
    </div>
  );
  return (
    <>
      <Head eyebrow={`Line ${p.line} · Employee #${p.code}`} title={<span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}><Avatar name={p.name} size={42} />{p.name}</span>} right={<Pill status={p.status} />} />
      <div className="rv-g4">{kpis.map(([l, v, s, bg]) => <div key={l} style={tile(bg)}><div><div style={tl}>{l}</div><div style={tv}>{v}</div><div style={ts}>{s}</div></div></div>)}</div>
      <div className="rv-g2">
        <Panel title="Calls through the day" sub="Calls started per hour · hover for each hour"><HourLine hours={data.hours} values={p.hours} /></Panel>
        <Panel title="Call funnel" sub="From dialled to real conversation"><Funnel f={p.funnel} /></Panel>
      </div>
      <div className="rv-g2">
        <Panel title="Calls by length" sub="Hover a column for its share"><LengthColumns b={p.b} /></Panel>
        <Panel title="Inbound vs outbound">
          <Donut slices={[{ label: "Inbound", value: p.inb, color: R.in }, { label: "Outbound", value: p.out, color: R.out }]} size={150} center={p.calls} sub="calls" />
          <Legend items={[[R.in, `Inbound ${p.inb} · ${pct(p.inb / p.calls)}`], [R.out, `Outbound ${p.out} · ${pct(p.out / p.calls)}`]]} />
        </Panel>
      </div>
      <div className="rv-gp">
        <div style={{ display: "grid", gap: 14 }}>
          {gap("⏱ Shortest gap between two calls", p.gapMin, "quickest back-to-back calls")}
          {gap("⏳ Longest gap between two calls", p.gapMax, "longest break between two calls")}
        </div>
        <Panel title="Numbers dialled by length">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["", "In", "Out"].map((h) => <th key={h} style={{ textAlign: h ? "right" : "left", fontSize: 10.5, color: R.mute, padding: 4 }}>{h}</th>)}</tr></thead>
            <tbody>{["10 digits", "11 digits", "12 digits", "Other"].map((l, i) => (
              <tr key={l}><td style={{ padding: 5, borderBottom: "1px solid #f1e8da" }}>{l}</td>
                <td style={{ padding: 5, textAlign: "right", fontWeight: 700, borderBottom: "1px solid #f1e8da" }}>{p.len[i][0]}</td>
                <td style={{ padding: 5, textAlign: "right", fontWeight: 700, borderBottom: "1px solid #f1e8da" }}>{p.len[i][1]}</td></tr>))}</tbody>
          </table>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: R.mute }}>Calls under 10 seconds: <b style={{ color: R.ink }}>{p.lt10}</b></p>
        </Panel>
      </div>
    </>
  );
}

