// Designed report PDF (approved mockup "I": D's side rail + tiles, G's hero + rings + heatmap):
// reportHtml() builds a self-contained A4-landscape page set, htmlToPdf() prints it with
// headless Chrome — the binary itself, so there is no npm dependency.
import { execFile } from "child_process";
import { existsSync, promises as fs } from "fs";
import os from "os";
import path from "path";

export type PdfPerson = {
  id?: string; // employee uuid, for the dashboard's per-person PDF download
  name: string; code: string; line: string;
  calls: number; inb: number; out: number; dur: number; avg: number; lt10: number;
  gapMin: number | null; gapMax: number | null; invalid: number;
  len: [number, number][]; // [in, out] for 10 / 11 / 12 digits / other
  b: number[];             // calls per length bucket, BUCKETS order
  hours: number[];         // 24 entries: calls started in each IST hour of the day
};
export type PdfInput = { title: string; period: string; people: PdfPerson[] };

export const BUCKETS = ["< 30s", "30–60s", "1–2 min", "2–3 min", "3–5 min", "5–10 min", "10–15 min", "15 min+"];
const LEN = ["10 digits", "11 digits", "12 digits", "Other"];
export const FUNNEL = ["Dialled", "Connected (10s+)", "Conversation (30s+)", "Engaged (1 min+)", "Long call (3 min+)"];
// Colours validated with the dataviz palette checker on the #fffdf8 card surface:
// IN/OUT pass every categorical check; RAMP passes the ordinal checks (ordered "how long");
// HEAT is a separate "how many" scale; MIX hues pass adjacent + wrap-around (donut).
export const IN = "#1f4fd1", OUT = "#e8641b", LINE = "#8c3f12";
export const RAMP = ["#e1a57c", "#d28c5b", "#c1743b", "#ae5e19", "#984900", "#7f3800", "#652800", "#4b1b00"];
const HEAT = ["#eadbc4", "#d9c3a3", "#c4a882", "#a98a64", "#8c6d4a", "#6f5338", "#553e29", "#3b2a1e"];
const MIX: [string, number[]][] = [["< 30s", [0]], ["30–60s", [1]], ["1–3 min", [2, 3]], ["3–10 min", [4, 5]], ["10 min+", [6, 7]]];
const MIX_COLORS = ["#1baf7a", "#4a3aa7", "#eda100", "#e87ba4", "#008300"];
export const C = { page: "#f3ece0", card: "#fffdf8", line: "#e7dccb", soft: "#f7f0e5", ink: "#2b2118", mute: "#7a6a58", espresso: "#3b2a1e", gold: "#e3b778", good: "#3f7a3a", bad: "#b33a2e" };
// shortcut: status thresholds are our defaults, not client-approved; make them settings if the client sets targets
const MIN_RANKED_CALLS = 20, SHORT_LIMIT = 0.5, INVALID_LIMIT = 0.1;

export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pad = (n: number) => String(n).padStart(2, "0");
export const dur = (s: number | null) => s === null ? "—" : (s = Math.round(s)) < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
export const pct = (x: number) => `${Math.round((Number.isFinite(x) ? x : 0) * 100)}%`;
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const ini = (n: string) => esc(n.trim().split(/\s+/).map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase());
export const hr = (h: number) => `${h % 12 || 12}${h % 24 < 12 ? "am" : "pm"}`;
const niceMax = (v: number) => { const step = v <= 20 ? 10 : v <= 60 ? 20 : v <= 120 ? 40 : v <= 400 ? 100 : v <= 1000 ? 200 : 500; return Math.max(step, Math.ceil(v / step) * step); };

export type Person = PdfPerson & { short: number; meaningful: number; invPct: number; funnel: number[] };

/** Everything both the PDF and the email show: per-person ratios, team totals, hour axis, ranking, highlights. */
export function summarize(input: PdfInput) {
  const people: Person[] = input.people.map((p) => ({
    ...p,
    short: p.calls ? p.b[0] / p.calls : 0,
    meaningful: p.calls ? 1 - p.b[0] / p.calls : 0,
    invPct: p.out ? p.invalid / p.out : 0, // invalid numbers are only counted on outbound calls
    funnel: [p.calls, p.calls - p.lt10, p.calls - p.b[0], sum(p.b.slice(2)), sum(p.b.slice(4))],
  }));
  const active = people.filter((p) => p.calls > 0).sort((a, b) => b.dur - a.dur);
  const idle = people.filter((p) => p.calls === 0);
  const T = {
    calls: sum(active.map((p) => p.calls)), inb: sum(active.map((p) => p.inb)), out: sum(active.map((p) => p.out)),
    dur: sum(active.map((p) => p.dur)), invalid: sum(active.map((p) => p.invalid)),
    b: BUCKETS.map((_, i) => sum(active.map((p) => p.b[i]))),
    h: Array.from({ length: 24 }, (_, i) => sum(active.map((p) => p.hours[i] ?? 0))),
    funnel: [0, 1, 2, 3, 4].map((i) => sum(active.map((p) => p.funnel[i]))),
  };
  // Hour axis: at least 9am–5pm, widened to any hour that had calls
  const used = T.h.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
  const lo = Math.min(9, ...used), hi = Math.max(17, ...used);
  const HOURS = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const hoursOf = (h: number[]) => HOURS.map((x) => h[x] ?? 0);
  const teamHours = hoursOf(T.h);
  const peakI = teamHours.indexOf(Math.max(...teamHours));
  const avgAll = T.calls ? Math.round(T.dur / T.calls) : null;

  const ranked = active.filter((p) => p.calls >= MIN_RANKED_CALLS); // a 2-call line would "win" every average
  const top = ranked[0];
  const mostShort = ranked.reduce<Person | undefined>((a, b) => (!a || b.short > a.short ? b : a), undefined);
  const status = (p: Person): [string, string] =>
    p.calls < MIN_RANKED_CALLS ? ["Low volume", "neu"] : p === top ? ["Top performer", "ok"]
      : p.short > SHORT_LIMIT || p.invPct > INVALID_LIMIT ? ["Needs attention", "bad"] : ["On track", "ok"];
  const insights = [
    top && `<b>${esc(top.name)}</b> led with <b>${dur(top.dur)}</b> of talk time over ${top.calls} calls.`,
    mostShort && mostShort.short > 0 && `<b>${pct(mostShort.short)}</b> of ${esc(mostShort.name)}'s calls ended in under 30 seconds (team ${pct(T.b[0] / T.calls)}).`,
    T.calls && `Busiest hour was <b>${hr(HOURS[peakI])}–${hr(HOURS[peakI] + 1)}</b> with ${teamHours[peakI]} calls.`,
    T.invalid && `<b>${T.invalid}</b> invalid numbers dialled, ${pct(T.invalid / T.out)} of outbound calls.`,
    idle.length && `<b>${idle.map((p) => esc(p.name)).join(", ")}</b> made no calls.`,
  ].filter(Boolean) as string[];

  const showTeam = active.length > 1;
  return { people, active, idle, T, HOURS, hoursOf, teamHours, peakI, avgAll, ranked, top, status, insights, showTeam };
}

/** The report as JSON for the dashboard's report pages — same numbers as the PDF and email. */
export function reportData(input: PdfInput) {
  const S = summarize(input);
  return {
    title: input.title, period: input.period, hours: S.HOURS,
    team: { ...S.T, hours: S.teamHours, avg: S.avgAll, peakHour: S.T.calls ? S.HOURS[S.peakI] : null },
    people: S.active.map((p) => ({ ...p, hours: S.hoursOf(p.hours), status: S.status(p) })),
    idle: S.idle.map((p) => p.name),
    top: S.top?.code ?? null,
    insights: S.insights, // HTML with <b> only; every name in it went through esc()
    canCompare: S.ranked.length > 1,
  };
}
export type ReportData = ReturnType<typeof reportData>;

/** Calls-per-hour line with the busiest hour labelled. Shared by the PDF and (as a PNG) the email. */
export function lineChartSvg(vals: number[], HOURS: number[], id: string, W = 560, H = 170): string {
  const L = 34, R = 12, Tp = 38, B = 28, max = niceMax(Math.max(...vals));
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, vals.length - 1), y = (v: number) => Tp + (1 - v / max) * (H - Tp - B);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const pk = vals.indexOf(Math.max(...vals)), anchor = pk === 0 ? "start" : pk === vals.length - 1 ? "end" : "middle";
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" font-family="Inter,Arial" role="img" aria-label="Calls per hour">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${LINE}" stop-opacity=".28"/><stop offset="1" stop-color="${LINE}" stop-opacity="0"/></linearGradient></defs>
    ${[0, max / 2, max].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#efe4d3"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="${C.mute}">${v}</text>`).join("")}
    <polygon points="${x(0)},${y(0)} ${pts} ${x(vals.length - 1)},${y(0)}" fill="url(#${id})"/>
    <polyline points="${pts}" fill="none" stroke="${LINE}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === pk ? 5 : 3.5}" fill="${i === pk ? LINE : C.card}" stroke="${LINE}" stroke-width="2"/>`).join("")}
    ${vals[pk] ? `<text x="${x(pk)}" y="${y(vals[pk]) - 10}" text-anchor="${anchor}" font-size="11" font-weight="700" fill="${C.ink}">${vals[pk]} calls</text>
    <text x="${x(pk)}" y="${y(vals[pk]) - 23}" text-anchor="${anchor}" font-size="9" font-weight="700" letter-spacing=".08em" fill="${LINE}">BUSIEST HOUR</text>` : ""}
    ${HOURS.map((h, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${C.mute}">${hr(h)}</text>`).join("")}</svg>`;
}

export function reportHtml(input: PdfInput): string {
  const { people, active, idle, T, HOURS, hoursOf, teamHours, avgAll, top, status, insights, showTeam } = summarize(input);
  const lineChart = (vals: number[], id: string, W = 560, H = 170) => lineChartSvg(vals, HOURS, id, W, H);

  // ── charts ──
  const funnelSvg = (f: number[], row = 28) => {
    const max = f[0] || 1, cx = 120;
    return `<svg width="100%" viewBox="0 0 360 ${f.length * (row + 4)}" font-family="Inter,Arial" role="img" aria-label="Call funnel">${f.map((v, i) => {
      const w1 = Math.max(18, (v / max) * 230), w2 = Math.max(14, ((f[i + 1] ?? v * 0.8) / max) * 230), yy = i * (row + 4);
      return `<path d="M${cx - w1 / 2} ${yy} H${cx + w1 / 2} L${cx + w2 / 2} ${yy + row} H${cx - w2 / 2} Z" fill="${RAMP[[0, 2, 4, 5, 7][i]]}"/>
        <text x="${cx}" y="${yy + row / 2 + 4}" text-anchor="middle" font-size="12" font-weight="800" fill="${i >= 2 ? "#fff" : C.ink}">${v}</text>
        <text x="250" y="${yy + row / 2 - 2}" font-size="11" font-weight="600" fill="${C.ink}">${FUNNEL[i]}</text>
        <text x="250" y="${yy + row / 2 + 12}" font-size="10" fill="${C.mute}">${pct(v / max)} of dialled</text>`;
    }).join("")}</svg>`;
  };
  const ring = (frac: number, size: number, color: string, center: string, track = "#efe4d3", ink = C.ink) => {
    const c = 2 * Math.PI * 42;
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${center}"><circle cx="50" cy="50" r="42" fill="none" stroke="${track}" stroke-width="9"/>
      <circle cx="50" cy="50" r="42" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${Math.max(0.01, c * frac)} ${c}" transform="rotate(-90 50 50)"/>
      <text x="50" y="57" text-anchor="middle" font-size="19" font-weight="800" fill="${ink}" font-family="Inter,Arial">${center}</text></svg>`;
  };
  const donut = (vals: number[], colors: string[], size: number, center: number) => {
    const c = 2 * Math.PI * 40, tot = sum(vals) || 1; let off = 0;
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${center} calls">${vals.map((v, i) => {
      if (!v) return ""; const len = (v / tot) * c;
      const s = `<circle cx="50" cy="50" r="40" fill="none" stroke="${colors[i]}" stroke-width="14" stroke-dasharray="${Math.max(len - 1.2, 0.6)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 50 50)"/>`;
      off += len; return s;
    }).join("")}<text x="50" y="51" text-anchor="middle" font-size="17" font-weight="800" fill="${C.ink}" font-family="Inter,Arial">${center}</text><text x="50" y="62" text-anchor="middle" font-size="8" fill="${C.mute}" font-family="Inter,Arial">calls</text></svg>`;
  };
  const grouped = (W = 560, H = 165) => {
    const max = niceMax(Math.max(...active.map((p) => Math.max(p.inb, p.out)))), Tp = 18, base = H - 30, gw = (W - 34) / active.length;
    const bw = Math.min(30, gw / 2 - 4), y = (v: number) => base - (v / max) * (base - Tp);
    const col = (x: number, v: number, color: string) => v ? `<path d="M${x} ${base} V${y(v) + 4} q0 -4 4 -4 h${bw - 8} q4 0 4 4 V${base}Z" fill="${color}"/><text x="${x + bw / 2}" y="${y(v) - 5}" text-anchor="middle" font-size="11" font-weight="700" fill="${C.ink}">${v}</text>` : "";
    return `<svg width="100%" viewBox="0 0 ${W} ${H}" font-family="Inter,Arial" role="img" aria-label="Inbound and outbound per person">
      ${[0, max / 2, max].map((v) => `<line x1="34" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#efe4d3"/><text x="26" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="${C.mute}">${v}</text>`).join("")}
      ${active.map((p, i) => { const cx = 34 + (i + 0.5) * gw; return col(cx - bw - 1, p.inb, IN) + col(cx + 1, p.out, OUT) + `<text x="${cx}" y="${base + 18}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${C.ink}">${esc(p.name.split(/\s+/)[0])}</text>`; }).join("")}</svg>`;
  };
  const columns = (b: number[], W = 440, H = 120) => {
    const max = Math.max(...b, 1), bw = W / 8;
    return `<svg width="100%" viewBox="0 0 ${W} ${H + 30}" font-family="Inter,Arial" role="img" aria-label="Calls by length"><line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="#d8c9b3"/>${b.map((v, i) => {
      const h = (v / max) * (H - 22), x = i * bw + 6, w = bw - 12;
      return `${v ? `<path d="M${x} ${H} V${H - h + 4} q0 -4 4 -4 h${w - 8} q4 0 4 4 V${H}Z" fill="${RAMP[i]}"/>` : ""}<text x="${x + w / 2}" y="${H - h - 6}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.ink}">${v}</text><text x="${x + w / 2}" y="${H + 18}" text-anchor="middle" font-size="10" fill="${C.mute}">${BUCKETS[i]}</text>`;
    }).join("")}</svg>`;
  };
  const legend = (items: [string, string][]) => `<div class="lg">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("")}</div>`;
  const ICON: Record<string, string> = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
  };
  const icon = (k: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

  // ── pages ──
  // One person's own report (individual schedules): just their page — "led the team", "1/1 staff" would be noise
  const solo = people.length === 1 && active.length === 1;
  const sections = [...(solo ? [] : ["Overview"]), ...(showTeam ? ["Team"] : []), ...active.map((p) => esc(p.name))];
  const title = esc(input.title), period = esc(input.period);
  const pg = (cls: string, active_: number, body: string) => `<section class="pg ${cls}"><aside class="rail"><div class="brand"><i>MMS</i><div>Max Music School<small>${title}</small></div></div>
    <div class="date">${period}</div><nav>${sections.map((s, i) => `<span class="${i === active_ ? "on" : ""}">${s}</span>`).join("")}</nav>
    <div class="foot">Generated by CallFlow<br>Page ${active_ + 1} of ${sections.length}</div></aside><div class="body">${body}</div></section>`;
  const tile = (ic: string, l: string, v: string | number, s: string, bg: string) => `<div class="tile" style="background:${bg}"><div><div class="tl">${l}</div><div class="tv">${v}</div><div class="ts">${s}</div></div><div class="ti">${icon(ic)}</div></div>`;
  const head = (eyebrow: string, h1: string) => `<div class="hd"><div><small>${eyebrow}</small><h1>${h1}</h1></div><span class="chip">${period}</span></div>`;
  const idleNote = idle.length ? `No calls: ${idle.map((p) => esc(p.name)).join(", ")}` : "Everyone made calls";

  const mixVals = MIX.map(([, idx]) => sum(idx.map((i) => T.b[i])));
  const overview = pg("ov", 0, head("Overview", title) + `<div class="bento">
      <div class="hero"><div class="tl">Total calls</div><div class="big">${T.calls}</div>
        ${T.calls ? `<div class="sp"><div style="flex:${T.inb};background:${IN}"></div><div style="flex:${T.out};background:${OUT}"></div></div>` : ""}
        <div class="cap"><span><i style="background:${IN}"></i>${T.inb} inbound</span><span><i style="background:${OUT}"></i>${T.out} outbound</span></div>
        <ul>${insights.map((t) => `<li>${t}</li>`).join("")}</ul></div>
      ${tile("clock", "Talk time", dur(T.dur), avgAll === null ? "no calls" : `avg ${dur(avgAll)} per call`, "#c4622d")}
      <div class="tile" style="background:#a8641f"><div><div class="tl">Invalid numbers</div><div class="tv">${T.invalid}</div><div class="ts">of ${T.out} outbound</div></div>${ring(T.out ? T.invalid / T.out : 0, 70, "#fff", pct(T.invalid / T.out), "rgba(255,255,255,.25)", "#fff")}</div>
      ${tile("users", "Active staff", `${active.length}/${people.length}`, idleNote, "#8c5a3c")}
      <div class="tile top"><div><div class="tl">Top performer</div>${top ? `<div class="who"><span class="av big">${ini(top.name)}</span><div><b>${esc(top.name)}</b><small>${dur(top.dur)} talk · ${top.calls} calls</small></div></div>` : `<div class="who"><small>Not enough calls to rank</small></div>`}</div></div>
    </div>` + (T.calls ? `
    <div class="row"><div class="panel"><h3>Calls through the day</h3><small>All staff, calls started per hour</small>${lineChart(teamHours, "pt")}</div>
      <div class="panel"><h3>Call funnel</h3><small>From dialled to real conversation</small><div style="margin-top:12px">${funnelSvg(T.funnel)}</div></div></div>
    <div class="row"><div class="panel"><h3>Calls per person</h3><small>Inbound vs outbound</small>${grouped()}${legend([[IN, "Inbound"], [OUT, "Outbound"]])}</div>
      <div class="panel center"><h3>Call length mix</h3><small>All ${T.calls} calls</small><div style="margin-top:8px">${donut(mixVals, MIX_COLORS, 130, T.calls)}</div>
        <div class="mixlg">${MIX.map(([l], i) => `<span><i style="background:${MIX_COLORS[i]}"></i>${l}<b>${mixVals[i]}</b><em>${pct(mixVals[i] / T.calls)}</em></span>`).join("")}</div></div></div>`
    : `<div class="panel"><h3>No calls were recorded in this period.</h3></div>`));

  const maxCell = Math.max(1, ...active.flatMap((p) => p.b));
  const heat = (v: number) => { if (!v) return `<td class="z">·</td>`; const i = Math.min(7, Math.floor((v / maxCell) * 7.999)); return `<td style="background:${HEAT[i]};color:${i >= 3 ? "#fff" : C.ink}">${v}</td>`; };
  // Team page grows onto extra sheets for big teams instead of clipping rows
  const team = showTeam ? pg("flow", 1, head("Team", "Team performance") + `
    <div class="panel"><h3>Staff table</h3><small>Sorted by talk time · ${idleNote}</small>
      <table class="st"><tr><th>Staff</th><th>Calls</th><th>In / Out</th><th>Talk time</th><th>Avg</th><th>&lt; 30s</th><th>Invalid</th><th>Status</th></tr>
      ${active.map((p) => { const [s, k] = status(p); return `<tr><td><div class="who"><span class="av">${ini(p.name)}</span><div><b>${esc(p.name)}</b><small>Line ${esc(p.line)} · #${esc(p.code)}</small></div></div></td><td><b>${p.calls}</b></td><td>${p.inb} / ${p.out}</td><td>${dur(p.dur)}</td><td>${dur(p.avg)}</td><td>${pct(p.short)}</td><td>${p.invalid}</td><td><span class="pill ${k}">${s}</span></td></tr>`; }).join("")}</table></div>
    <div class="panel" style="margin-top:14px"><h3>Meaningful-call rate</h3><small>Share of each person's calls lasting 30 seconds or more</small>
      <div class="rings">${active.map((p) => `<div>${ring(p.meaningful, 100, p.calls < MIN_RANKED_CALLS ? "#b9a68e" : p.meaningful < 1 - SHORT_LIMIT ? C.bad : "#c4622d", pct(p.meaningful))}<b>${esc(p.name)}</b><small>${p.calls} calls</small></div>`).join("")}</div></div>
    <div class="panel" style="margin-top:14px"><h3>Call length heatmap</h3><small>Number of calls in each length band · darker = more calls</small>
      <table class="heat"><tr><th></th>${BUCKETS.map((b) => `<th>${b}</th>`).join("")}</tr>${active.map((p) => `<tr><td class="nm">${esc(p.name)}</td>${p.b.map(heat).join("")}</tr>`).join("")}</table></div>`) : "";

  const first = solo ? 0 : showTeam ? 2 : 1;
  const person = (p: Person, i: number) => { const [s, k] = status(p); return pg("", first + i, `<div class="hd"><div class="who"><span class="av big">${ini(p.name)}</span><div><small>Line ${esc(p.line)} · Employee #${esc(p.code)}</small><h1>${esc(p.name)}</h1></div></div><span class="pill ${k}">${s}</span></div>
    <div class="kp">${([["Calls", p.calls, `${p.inb} in · ${p.out} out`], ["Talk time", dur(p.dur), solo ? `${pct(p.meaningful)} of calls 30s+` : `${pct(p.dur / T.dur)} of team`], ["Avg call", dur(p.avg), solo ? `${p.lt10} under 10s` : `team ${dur(avgAll)}`], ["Invalid nos.", p.invalid, `${pct(p.invPct)} of outbound`]] as [string, string | number, string][]).map(([l, v, s2]) => `<div><small>${l}</small><b>${v}</b><span>${s2}</span></div>`).join("")}</div>
    <div class="row"><div class="panel"><h3>Calls through the day</h3><small>Calls started per hour</small>${lineChart(hoursOf(p.hours), "pp" + i, 560, 165)}</div>
      <div class="panel"><h3>Call funnel</h3><small>From dialled to real conversation</small><div style="margin-top:12px">${funnelSvg(p.funnel, 26)}</div></div></div>
    <div class="row"><div class="panel"><h3>Calls by length</h3>${columns(p.b)}</div>
      <div class="panel center"><h3>Inbound vs outbound</h3>${donut([p.inb, p.out], [IN, OUT], 120, p.calls)}${legend([[IN, `Inbound ${p.inb}`], [OUT, `Outbound ${p.out}`]])}</div></div>
    <div class="row3"><div class="gap"><small>⏱ Shortest gap between two calls</small><b>${dur(p.gapMin)}</b></div><div class="gap"><small>⏳ Longest gap between two calls</small><b>${dur(p.gapMax)}</b></div>
      <div class="panel"><h3>Numbers dialled by length</h3><table class="t"><tr><th></th><th>In</th><th>Out</th></tr>${p.len.map((r, j) => `<tr><td>${LEN[j]}</td><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</table><small>Calls under 10s: <b>${p.lt10}</b></small></div></div>`); };

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · ${period}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${CSS}</style></head>
<body>${solo ? "" : overview}${team}${active.map(person).join("")}</body></html>`;
}

const CSS = `*{box-sizing:border-box}body{margin:0;background:#e6dccb;color:${C.ink};font-family:Inter,Arial,sans-serif}
  .pg{width:297mm;height:210mm;overflow:hidden;margin:20px auto;background:${C.page};display:flex}.pg.flow{height:auto;min-height:210mm;overflow:visible}
  @page{size:A4 landscape;margin:0}@media print{body{background:none}.pg{margin:0;height:209mm;break-after:page}.pg.flow{height:auto;min-height:209mm}.pg:last-child{break-after:auto}}
  .rail{width:58mm;flex:none;background:${C.espresso};color:#e9dccb;padding:22px 16px;display:flex;flex-direction:column}
  .brand{display:flex;gap:10px;align-items:center;font-weight:800;color:#fff;font-size:14px}.brand i{width:38px;height:38px;border-radius:10px;background:${OUT};display:grid;place-items:center;font-style:normal;font-size:12px;flex:none}
  .brand small{display:block;font-weight:500;color:#a8917a;font-size:11px}.date{margin:18px 0 22px;font-size:12px;color:${C.gold};font-weight:600}
  nav span{display:block;padding:8px 10px;border-radius:8px;font-size:12.5px;margin-bottom:2px}nav span.on{background:#5a4231;color:#fff;font-weight:600;box-shadow:inset 3px 0 0 ${C.gold}}
  .foot{margin-top:auto;font-size:11px;color:#a8917a}
  .body{flex:1;padding:18px 22px;min-width:0;zoom:.86}.pg.ov .body{zoom:.8}
  .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.hd small{color:${OUT};font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:10.5px}.hd h1{margin:2px 0 0;font-size:22px}
  .chip{background:${C.card};border:1px solid ${C.line};border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600}
  .bento{display:grid;grid-template-columns:1.5fr 1fr 1fr;grid-template-rows:auto auto;gap:12px;margin-bottom:12px}
  .hero{grid-row:span 2;border-radius:16px;padding:18px 20px;color:#fff;background:linear-gradient(150deg,#3b2a1e,#5a4231 70%,#7a5638)}
  .hero .big{font-size:64px;font-weight:800;line-height:1;margin:6px 0 12px}.sp{display:flex;gap:2px;height:12px;border-radius:6px;overflow:hidden}
  .cap{display:flex;justify-content:space-between;font-size:12px;margin-top:6px;color:#e9dccb}.cap i,.lg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}
  .hero ul{list-style:none;padding:0;margin:12px 0 0;font-size:12.5px;line-height:1.45}.hero li{padding:7px 0;border-top:1px solid rgba(255,255,255,.14)}.hero b{color:${C.gold}}
  .tile{border-radius:14px;padding:14px 16px;color:#fff;display:flex;justify-content:space-between;align-items:center}
  .tl{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;font-weight:600}.tv{font-size:26px;font-weight:800;margin:4px 0 2px}.ts{font-size:11.5px;opacity:.85}
  .ti{width:42px;height:42px;border-radius:12px;background:rgba(255,255,255,.16);display:grid;place-items:center;flex:none}
  .tile.top{background:${C.card};color:${C.ink};border:1px solid ${C.line}}.tile.top .tl{color:${C.mute};opacity:1}
  .who{display:flex;align-items:center;gap:10px;margin-top:6px}.who small{display:block;color:${C.mute};font-size:11.5px}
  .av{width:34px;height:34px;border-radius:50%;background:#f1dcc6;color:#7f3800;display:inline-grid;place-items:center;font-weight:700;font-size:12.5px;flex:none}.av.big{width:46px;height:46px;font-size:16px}
  .row{display:grid;grid-template-columns:1.55fr 1fr;gap:12px;margin-bottom:12px}.row3{display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:12px}
  .panel{background:${C.card};border:1px solid ${C.line};border-radius:14px;padding:14px 16px;min-width:0}.panel h3{margin:0;font-size:13.5px}.panel>small{color:${C.mute};font-size:11.5px}
  .center{text-align:center}.center .lg{justify-content:center}
  .mixlg{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;margin-top:8px;text-align:left;font-size:11.5px}.mixlg span{display:flex;align-items:center;gap:6px}.mixlg i{width:10px;height:10px;border-radius:3px;flex:none}.mixlg b{margin-left:auto}.mixlg em{font-style:normal;color:${C.mute};width:30px;text-align:right}
  .lg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:${C.mute};margin-top:8px}
  .pill{display:inline-block;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}.pill.ok{background:#e5efe0;color:${C.good}}.pill.bad{background:#f8e3df;color:${C.bad}}.pill.neu{background:#efe6d8;color:${C.mute}}
  table.st{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:10px}.st th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:${C.mute};background:${C.soft};padding:8px}.st td{padding:8px;border-bottom:1px solid #f1e8da}.st tr{break-inside:avoid}
  .rings{display:flex;flex-wrap:wrap;justify-content:space-around;gap:10px;margin-top:8px;text-align:center;font-size:12px}.rings b{display:block}.rings small{color:${C.mute}}
  table.heat{width:100%;border-collapse:separate;border-spacing:3px;font-size:12px;margin-top:8px}.heat th{font-size:10px;color:${C.mute};font-weight:600;text-transform:uppercase}.heat td{text-align:center;padding:8px 4px;border-radius:6px;font-weight:700}.heat td.nm{text-align:left;font-weight:600}.heat td.z{color:#cdbba1;background:${C.soft}}
  .kp{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px}.kp div{border-radius:14px;padding:12px 16px;color:#fff}
  .kp div:nth-child(1){background:#c4622d}.kp div:nth-child(2){background:#a8641f}.kp div:nth-child(3){background:#8c5a3c}.kp div:nth-child(4){background:#5b4636}
  .kp small{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;opacity:.85;font-weight:600}.kp b{display:block;font-size:24px;margin:2px 0}.kp span{font-size:11.5px;opacity:.85}
  .gap{border:1.5px dashed #d8c9b3;background:${C.card};border-radius:14px;padding:16px;display:flex;flex-direction:column;justify-content:center}.gap small{color:${C.mute};font-size:11.5px;font-weight:600}.gap b{font-size:26px;margin-top:4px}
  .t{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0}.t td,.t th{padding:4px;border-bottom:1px solid #f1e8da;text-align:left}.t td:not(:first-child),.t th:not(:first-child){text-align:right;font-weight:700}.t th{font-size:10px;color:${C.mute}}
  /* Dashboard view narrower than an A4 page: drop the rail and reflow. Screen only, so the PDF (1123px wide) keeps its layout. */
  @media screen and (max-width:1150px){body{background:${C.page}}.pg{width:auto;height:auto;margin:0 0 16px}.body,.pg.ov .body{zoom:1;padding:12px}.rail{display:none}
    .bento,.row,.row3,.kp{grid-template-columns:1fr 1fr}.hero{grid-row:auto;grid-column:span 2}}
  @media screen and (max-width:640px){.bento,.row,.row3,.kp{grid-template-columns:1fr}.hero{grid-column:auto}.st{display:block;overflow-x:auto}}`;

const CHROME_PATHS = [
  "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
export function findChrome(): string | null {
  const env = process.env.CHROME_PATH;
  if (env) return existsSync(env) ? env : null;
  return CHROME_PATHS.find((p) => existsSync(p)) ?? null;
}

// One Chrome at a time: the droplet has 512 MB and each render takes ~150–250 MB
let queue: Promise<unknown> = Promise.resolve();
function queued(job: () => Promise<Buffer>): Promise<Buffer> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

export function htmlToPdf(html: string): Promise<Buffer> {
  return queued(() => render(html, "pdf", "%PDF-", (out) => [
    "--no-pdf-header-footer", "--virtual-time-budget=10000", // lets the Inter web font load before printing
    `--print-to-pdf=${out}`,
  ]));
}

/** An SVG chart as a 2× PNG (Gmail drops inline SVG, so the email embeds these instead). */
export function svgToPng(svg: string, W: number, H: number): Promise<Buffer> {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${C.card}">${svg.replace('width="100%"', `width="${W}" height="${H}"`)}</body>`;
  return queued(() => render(html, "png", "\x89PNG", (out) => [
    "--hide-scrollbars", "--force-device-scale-factor=2", `--window-size=${W},${H}`, `--screenshot=${out}`,
  ]));
}

async function render(html: string, ext: string, magic: string, outputArgs: (out: string) => string[]): Promise<Buffer> {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome not found (set CHROME_PATH)");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "callflow-render-"));
  try {
    const page = path.join(dir, "page.html"), out = path.join(dir, `out.${ext}`); // --screenshot needs the extension
    await fs.writeFile(page, html);
    await new Promise<void>((resolve, reject) =>
      execFile(chrome, [
        "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run",
        `--user-data-dir=${path.join(dir, "profile")}`, ...outputArgs(out), `file://${page}`,
      ], { timeout: 90_000 }, (err) => (err ? reject(err) : resolve()))
    );
    const buf = await fs.readFile(out);
    if (buf.subarray(0, magic.length).toString("latin1") !== magic) throw new Error("Chrome did not produce the expected file");
    return buf;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
