// Designed report email body (approved mockup "H"). Email clients ignore <style> and drop SVG, so
// this is tables + inline styles only; the hourly line charts are returned as SVG for the caller to
// turn into PNGs and attach inline (cid:). Same figures as the PDF, via summarize().
import { BUCKETS, C, FUNNEL, IN, LINE, OUT, RAMP, dur, esc, hr, ini, lineChartSvg, pct, summarize, type PdfInput, type Person } from "./reportPdf";

export type EmailChart = { cid: string; svg: string; width: number; height: number };

const F = "font-family:Inter,Arial,Helvetica,sans-serif;";
const CHART_W = 600; // inner width of the 680px email column

/** Removes the chart blocks whose PNG could not be rendered, so the rest of the email still goes out. */
export function dropCharts(html: string, cids: string[]): string {
  return cids.reduce((h, id) => h.replace(new RegExp(`<!--chart:${id}-->[\\s\\S]*?<!--/chart:${id}-->`), ""), html);
}

export function reportEmailHtml(input: PdfInput): { html: string; charts: EmailChart[] } {
  const S = summarize(input);
  const { people, active, idle, T, HOURS, hoursOf, teamHours, peakI, avgAll, ranked } = S;
  const single = people.length === 1;
  const charts: EmailChart[] = [];
  const chart = (vals: number[], height: number) => {
    const cid = `chart${charts.length + 1}`;
    charts.push({ cid, svg: lineChartSvg(vals, HOURS, cid, CHART_W, height), width: CHART_W, height });
    return `<!--chart:${cid}--><img src="cid:${cid}" width="${CHART_W}" alt="Calls per hour" style="display:block;width:100%;max-width:${CHART_W}px;height:auto;border:0"><!--/chart:${cid}-->`;
  };

  // ▲ best / ▼ weakest of the day, only when there are at least two people worth comparing
  type Key = "calls" | "dur" | "avg" | "short" | "invPct";
  const best = (k: Key, hi: boolean) => ranked.reduce((a, b) => ((hi ? b[k] > a[k] : b[k] < a[k]) ? b : a));
  const mark = (p: Person, k: Key, hi: boolean, t: string | number) =>
    ranked.length < 2 || !ranked.includes(p) ? t
      : p === best(k, hi) ? `<span style="color:${C.good};font-weight:700">▲ ${t}</span>`
      : p === best(k, !hi) ? `<span style="color:${C.bad};font-weight:700">▼ ${t}</span>` : t;
  const bar = (v: number, max: number) => `<div style="width:80px;height:6px;background:#efe4d3;border-radius:3px;margin-top:4px"><div style="width:${Math.max(3, Math.round((v / (max || 1)) * 100))}%;height:6px;background:${LINE};border-radius:3px"></div></div>`;
  const kpi = (l: string, v: string | number, s: string) => `<td style="width:25%;padding:6px;vertical-align:top"><div style="background:${C.card};border:1px solid ${C.line};border-top:3px solid ${OUT};border-radius:10px;padding:14px"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${C.mute};font-weight:600">${l}</div><div style="font-size:26px;font-weight:800;margin-top:4px">${v}</div><div style="font-size:12px;color:${C.mute};margin-top:2px">${s}</div></div></td>`;
  const th = (t: string) => `<th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${C.mute};font-weight:600;padding:10px 8px;background:${C.soft}">${t}</th>`;
  const td = (x: string | number) => `<td style="padding:10px 8px;font-size:14px;border-top:1px solid #f1e8da">${x}</td>`;
  const sec = (t: string, s = "") => `<tr><td style="padding:20px 24px 4px"><div style="font-size:16px;font-weight:700">${t}</div>${s ? `<div style="font-size:12px;color:${C.mute};margin-top:2px">${s}</div>` : ""}</td></tr>`;
  const box = (inner: string) => `<tr><td style="padding:8px 24px"><div style="background:${C.card};border:1px solid ${C.line};border-radius:12px;padding:14px 16px">${inner}</div></td></tr>`;
  const sub = (t: string) => `<div style="font-size:13px;font-weight:700;margin-bottom:8px">${t}</div>`;
  const idleNote = idle.length ? `No calls: ${idle.map((p) => `<b>${esc(p.name)}</b>`).join(", ")}` : "";

  // Email-safe funnel: centred table rows that narrow stage by stage
  const funnel = (f: number[]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${f.map((v, i) =>
    `<tr><td align="center" style="padding:2px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="width:${Math.max(16, Math.round((v / (f[0] || 1)) * 100))}%;border-collapse:collapse"><tr><td style="background:${RAMP[[0, 2, 4, 5, 7][i]]};color:${i >= 2 ? "#fff" : C.ink};font-size:13px;font-weight:800;text-align:center;padding:8px 4px;border-radius:6px">${v}</td></tr></table></td>
     <td style="width:190px;padding:2px 0 2px 12px;font-size:12.5px"><b>${FUNNEL[i]}</b><div style="color:${C.mute};font-size:11.5px">${pct(v / (f[0] || 1))} of dialled</div></td></tr>`).join("")}</table>`;

  const inOut = (p: Person) => {
    const inW = Math.round((p.inb / p.calls) * 100);
    const tile = (arrow: string, label: string, n: number, col: string, bg: string) => `<td style="width:50%;padding:4px"><div style="background:${bg};border-radius:10px;padding:12px 14px">
      <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:13px;background:${col};color:#fff;font-weight:800;font-size:14px;vertical-align:middle">${arrow}</span>
      <span style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;vertical-align:middle;margin-left:6px">${label}</span>
      <div style="font-size:24px;font-weight:800;margin-top:6px">${n} <span style="font-size:13px;color:${C.mute};font-weight:600">${pct(n / p.calls)}</span></div></div></td>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tile("↙", "Inbound", p.inb, IN, "#eaf0fd")}${tile("↗", "Outbound", p.out, OUT, "#fdeee5")}</tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin-top:8px"><tr>${inW ? `<td style="width:${inW}%;height:14px;background:${IN};border-radius:7px 0 0 7px"></td>` : ""}${inW < 100 ? `<td style="height:14px;background:${OUT};border-radius:${inW ? "0 7px 7px 0" : "7px"}"></td>` : ""}</tr></table>`;
  };
  const gaps = (p: Person) => {
    const g = (label: string, v: number | null, note: string) => `<td style="width:50%;padding:4px"><div style="border:1px dashed #d8c9b3;border-radius:10px;padding:12px 14px;background:${C.card}">
      <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:${C.mute}">${label}</div><div style="font-size:24px;font-weight:800;margin-top:4px">${dur(v)}</div><div style="font-size:11.5px;color:${C.mute}">${note}</div></div></td>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${g("⏱ Shortest gap", p.gapMin, "quickest back-to-back calls")}${g("⏳ Longest gap", p.gapMax, "longest break between two calls")}</tr></table>`;
  };
  const person = (p: Person) => {
    const max = Math.max(...p.b, 1);
    const br = p.b.map((v, i) => `<tr><td style="font-size:12px;color:${C.mute};padding:3px 8px 3px 0;width:70px;white-space:nowrap">${BUCKETS[i]}</td><td style="padding:3px 0">${v ? `<div style="width:${Math.max(1, Math.round((v / max) * 100))}%;height:12px;background:${RAMP[i]};border-radius:0 4px 4px 0"></div>` : `<div style="height:12px;border-left:1px solid #d8c9b3"></div>`}</td><td style="font-size:12px;font-weight:700;padding-left:8px;width:34px;text-align:right">${v}</td></tr>`).join("");
    const mini = (l: string, v: string | number) => `<td style="padding:4px"><div style="background:${C.soft};border-radius:8px;padding:10px"><div style="font-size:11px;color:${C.mute};text-transform:uppercase;letter-spacing:.05em;font-weight:600">${l}</div><div style="font-size:18px;font-weight:700;margin-top:2px">${v}</div></div></td>`;
    const part = (inner: string) => `<tr><td style="padding:12px 16px;border-top:1px solid #f1e8da">${inner}</td></tr>`;
    return `<tr><td style="padding:8px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;border-collapse:separate">
      <tr><td style="padding:14px 16px"><span style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background:#f1dcc6;color:#7f3800;font-weight:700;text-align:center;font-size:13px">${ini(p.name)}</span>
        <span style="font-size:16px;font-weight:700;margin-left:8px">${esc(p.name)}</span><span style="font-size:12px;color:${C.mute};margin-left:6px">Line ${esc(p.line)} · Employee #${esc(p.code)}</span></td></tr>
      ${part(`<table role="presentation" width="100%"><tr>${mini("Calls", p.calls)}${mini("Talk time", dur(p.dur))}${mini("Avg call", dur(p.avg))}${mini("Invalid", p.invalid)}</tr></table>`)}
      ${part(sub("Calls through the day") + chart(hoursOf(p.hours), 150))}
      ${part(sub("Call length") + `<table role="presentation" width="100%">${br}</table>`)}
      ${part(sub("Inbound vs outbound") + inOut(p))}
      ${part(sub("Gap between two calls") + gaps(p) + `<div style="font-size:12px;color:${C.mute};margin-top:8px">Calls under 10 seconds: <b style="color:${C.ink}">${p.lt10}</b></div>`)}
    </table></td></tr>`;
  };

  const maxC = Math.max(1, ...active.map((p) => p.calls)), maxD = Math.max(1, ...active.map((p) => p.dur));
  const team = active.length > 1 ? `
  ${sec("Team at a glance", `Sorted by talk time.${ranked.length > 1 ? ` <span style="color:${C.good}">▲</span> best and <span style="color:${C.bad}">▼</span> weakest.` : ""}`)}
  <tr><td style="padding:8px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;border-collapse:separate;overflow:hidden"><tr>${th("Staff")}${th("Calls")}${th("Talk time")}${th("Avg call")}${th("&lt; 30s")}${th("Invalid")}</tr>
    ${active.map((p) => `<tr>${td(`<b>${esc(p.name)}</b><div style="font-size:12px;color:${C.mute}">Line ${esc(p.line)} · #${esc(p.code)}</div>`)}${td(mark(p, "calls", true, p.calls) + bar(p.calls, maxC))}${td(mark(p, "dur", true, dur(p.dur)) + bar(p.dur, maxD))}${td(mark(p, "avg", true, dur(p.avg)))}${td(mark(p, "short", false, pct(p.short)))}${td(mark(p, "invPct", false, p.invalid))}</tr>`).join("")}</table>
    ${idleNote ? `<div style="font-size:12px;color:${C.mute};margin-top:8px">${idleNote}</div>` : ""}</td></tr>
  ${sec("Calls through the day", `All staff · busiest hour ${hr(HOURS[peakI])}–${hr(HOURS[peakI] + 1)} (${teamHours[peakI]} calls)`)}
  ${box(chart(teamHours, 210))}
  ${sec("Call funnel", "How many calls turned into real conversations")}
  ${box(funnel(T.funnel))}
  ${sec("Individual reports")}` : "";

  const body = T.calls
    ? team + active.map(person).join("") + (active.length === 1 && idleNote ? `<tr><td style="padding:4px 24px;font-size:12px;color:${C.mute}">${idleNote}</td></tr>` : "")
    : box(`<div style="font-size:14px;font-weight:600">No calls were recorded in this period.</div>`);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.title)}</title></head>
<body style="margin:0;background:${C.page}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};${F}color:${C.ink}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#faf5ec;border-radius:14px;overflow:hidden;border:1px solid ${C.line}">
  <tr><td style="background:${C.espresso};padding:24px 28px;color:#fff;border-bottom:4px solid ${OUT}"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${C.gold};font-weight:600">Max Music School · CallFlow</div>
    <div style="font-size:26px;font-weight:800;margin-top:6px">${esc(input.title)}</div><div style="font-size:14px;color:#d9c8b3;margin-top:2px">${esc(input.period)}</div></td></tr>
  <tr><td style="padding:16px 18px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${kpi("Total calls", T.calls, `${T.inb} in · ${T.out} out`)}${kpi("Talk time", dur(T.dur), avgAll === null ? "no calls" : `avg ${dur(avgAll)} / call`)}${kpi("Invalid nos.", T.invalid, `${pct(T.invalid / T.out)} of outbound`)}
    ${single ? kpi("Under 10s", people[0].lt10, "very short calls") : kpi("Active staff", `${active.length}<span style="font-size:15px;color:${C.mute}"> / ${people.length}</span>`, "made calls")}</tr></table></td></tr>
  ${body}
  <tr><td style="padding:18px 24px 24px;font-size:11px;color:#a8917a;text-align:center">Valid numbers: 0 + 10 digits, 91 + 10 digits, or a 10-digit mobile starting 6–9.<br>Sent automatically by CallFlow · The full report is attached as a PDF.</td></tr>
</table></td></tr></table></body></html>`;
  // shortcut: ~8 KB of HTML per person; Gmail clips mails over ~102 KB, so a combined mail past ~11 active staff gets "View entire message". Trim cards if teams grow.
  return { html, charts };
}
