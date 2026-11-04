"use client";

// Report dashboard building blocks: the beige report theme and interactive SVG charts
// (hover tooltips, click-through). Colours match the emailed PDF; they were validated with
// the dataviz palette checker on the #fffdf8 card surface.
import { useState, type CSSProperties, type ReactNode } from "react";

export const R = {
  page: "#f3ece0", card: "#fffdf8", line: "#e7dccb", soft: "#f7f0e5", ink: "#2b2118", mute: "#7a6a58",
  espresso: "#3b2a1e", gold: "#e3b778", good: "#3f7a3a", bad: "#b33a2e",
  in: "#1f4fd1", out: "#e8641b", trend: "#8c3f12",
  ramp: ["#e1a57c", "#d28c5b", "#c1743b", "#ae5e19", "#984900", "#7f3800", "#652800", "#4b1b00"], // call length, short → long
  heat: ["#eadbc4", "#d9c3a3", "#c4a882", "#a98a64", "#8c6d4a", "#6f5338", "#553e29", "#3b2a1e"], // how many
  mix: ["#1baf7a", "#4a3aa7", "#eda100", "#e87ba4", "#008300"], // donut slices: distinct hues, no blue/orange
};
export const BUCKETS = ["< 30s", "30–60s", "1–2 min", "2–3 min", "3–5 min", "5–10 min", "10–15 min", "15 min+"];
export const MIX: [string, number[]][] = [["< 30s", [0]], ["30–60s", [1]], ["1–3 min", [2, 3]], ["3–10 min", [4, 5]], ["10 min+", [6, 7]]];
export const FUNNEL = ["Dialled", "Connected (10s+)", "Conversation (30s+)", "Engaged (1 min+)", "Long call (3 min+)"];

const pad = (n: number) => String(n).padStart(2, "0");
export const dur = (s: number | null) => {
  if (s === null) return "—";
  s = Math.round(s);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
};
export const pct = (x: number) => `${Math.round((Number.isFinite(x) ? x : 0) * 100)}%`;
export const hr = (h: number) => `${h % 12 || 12}${h % 24 < 12 ? "am" : "pm"}`;
export const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase();
const niceMax = (v: number) => { const step = v <= 20 ? 10 : v <= 60 ? 20 : v <= 120 ? 40 : v <= 400 ? 100 : v <= 1000 ? 200 : 500; return Math.max(step, Math.ceil(v / step) * step); };

export function Panel({ title, sub, children, style }: { title: string; sub?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "16px 18px", minWidth: 0, display: "flex", flexDirection: "column", ...style }}>
      <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: R.ink }}>{title}</h3>
      {sub && <p style={{ margin: "2px 0 0", fontSize: 12, color: R.mute }}>{sub}</p>}
      {/* A panel stretched to its row-mate's height centres its content instead of leaving a gap at the bottom */}
      <div style={{ marginTop: 12, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>{children}</div>
    </section>
  );
}

export function Pill({ status }: { status: [string, "ok" | "bad" | "neu"] }) {
  const [text, kind] = status;
  const c = { ok: ["#e5efe0", R.good, "✓ "], bad: ["#f8e3df", R.bad, "! "], neu: ["#efe6d8", R.mute, ""] }[kind];
  return <span style={{ display: "inline-block", fontSize: 11.5, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: c[0], color: c[1], whiteSpace: "nowrap" }}>{c[2]}{text}</span>;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: "#f1dcc6", color: "#7f3800", display: "inline-grid", placeItems: "center", fontWeight: 700, fontSize: size * 0.36, flex: "none" }}>
      {initials(name)}
    </span>
  );
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 12, color: R.mute, marginTop: 10 }}>
      {items.map(([c, t]) => <span key={t}><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: c, marginRight: 6, verticalAlign: -1 }} />{t}</span>)}
    </div>
  );
}

/** Small dark tooltip, positioned in % of the chart box. */
function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div role="tooltip" style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%, calc(-100% - 10px))", background: R.espresso, color: "#fff", fontSize: 12, padding: "6px 10px", borderRadius: 8, whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 6px 16px -8px rgba(0,0,0,.5)", zIndex: 2 }}>
      {children}
    </div>
  );
}

/** Calls per hour: area line, busiest hour labelled, hover any hour for its count. */
export function HourLine({ hours, values, height = 200 }: { hours: number[]; values: number[]; height?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 600, H = height, L = 34, Rr = 12, T = 38, B = 28, max = niceMax(Math.max(...values, 0));
  const x = (i: number) => L + (i * (W - L - Rr)) / Math.max(1, values.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const pk = values.indexOf(Math.max(...values));
  const anchor = pk === 0 ? "start" : pk === values.length - 1 ? "end" : "middle";
  const step = (W - L - Rr) / Math.max(1, values.length - 1);
  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Calls per hour, busiest ${hr(hours[pk])}`} style={{ display: "block", fontFamily: "inherit" }}>
        <defs><linearGradient id="hl-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={R.trend} stopOpacity=".28" /><stop offset="1" stopColor={R.trend} stopOpacity="0" /></linearGradient></defs>
        {[0, max / 2, max].map((v) => (
          <g key={v}><line x1={L} x2={W - Rr} y1={y(v)} y2={y(v)} stroke="#efe4d3" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={R.mute}>{v}</text></g>
        ))}
        <polygon points={`${x(0)},${y(0)} ${pts} ${x(values.length - 1)},${y(0)}`} fill="url(#hl-fill)" />
        <polyline points={pts} fill="none" stroke={R.trend} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={T - 6} y2={y(0)} stroke={R.trend} strokeOpacity=".35" strokeDasharray="3 3" />}
        {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === pk || i === hi ? 5 : 3.5} fill={i === pk ? R.trend : R.card} stroke={R.trend} strokeWidth="2" />)}
        {values[pk] > 0 && <>
          <text x={x(pk)} y={y(values[pk]) - 23} textAnchor={anchor} fontSize="9" fontWeight="700" letterSpacing=".08em" fill={R.trend}>BUSIEST HOUR</text>
          <text x={x(pk)} y={y(values[pk]) - 10} textAnchor={anchor} fontSize="11" fontWeight="700" fill={R.ink}>{values[pk]} calls</text>
        </>}
        {hours.map((h, i) => <text key={h} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11.5" fill={R.mute}>{hr(h)}</text>)}
        {values.map((_, i) => <rect key={i} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHi(i)} />)}
      </svg>
      {hi !== null && <Tip x={(x(hi) / W) * 100} y={(y(values[hi]) / H) * 100}><b>{hr(hours[hi])}–{hr(hours[hi] + 1)}</b> · {values[hi]} calls</Tip>}
    </div>
  );
}

/** Dialled → long call, as narrowing bars with the share of dialled. */
export function Funnel({ f }: { f: number[] }) {
  const top = f[0] || 1;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {f.map((v, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 150px", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div title={`${FUNNEL[i]}: ${v}`} style={{ width: `max(56px, ${(v / top) * 100}%)`, // the count must always fit
 background: R.ramp[[0, 2, 4, 5, 7][i]], color: i >= 2 ? "#fff" : R.ink, textAlign: "center", fontWeight: 800, fontSize: 13, padding: "8px 4px", borderRadius: 6, transition: "width .3s" }}>{v}</div>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.3 }}><b>{FUNNEL[i]}</b><div style={{ color: R.mute, fontSize: 11.5 }}>{pct(v / top)} of dialled</div></div>
        </div>
      ))}
    </div>
  );
}

/** Donut with hover: the hovered slice's label and count replace the centre figure. */
export function Donut({ slices, size = 170, center, sub }: { slices: { label: string; value: number; color: string }[]; size?: number; center: number | string; sub: string }) {
  const [hi, setHi] = useState<number | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0) || 1, c = 2 * Math.PI * 40;
  let off = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={sub} onMouseLeave={() => setHi(null)} style={{ display: "block", margin: "0 auto" }}>
      {slices.map((s, i) => {
        if (!s.value) return null;
        const len = (s.value / total) * c, el = (
          <circle key={s.label} cx="50" cy="50" r="40" fill="none" stroke={s.color} strokeWidth={hi === i ? 17 : 14}
            strokeDasharray={`${Math.max(len - 1.2, 0.6)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 50 50)"
            style={{ cursor: "pointer", transition: "stroke-width .15s" }} onMouseEnter={() => setHi(i)} />
        );
        off += len;
        return el;
      })}
      <text x="50" y="50" textAnchor="middle" fontSize={hi === null ? 17 : 14} fontWeight="800" fill={R.ink}>{hi === null ? center : slices[hi].value}</text>
      <text x="50" y="62" textAnchor="middle" fontSize="8" fill={R.mute}>{hi === null ? sub : `${slices[hi].label} · ${pct(slices[hi].value / total)}`}</text>
    </svg>
  );
}

/** Inbound vs outbound per person; click a group to open that person. */
export function PeopleBars({ people, onPick }: { people: { key: string; name: string; inb: number; out: number }[]; onPick: (key: string) => void }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 600, H = 210, T = 22, base = H - 30, L = 34, gw = (W - L) / Math.max(1, people.length);
  const bw = Math.min(30, gw / 2 - 4), max = niceMax(Math.max(1, ...people.flatMap((p) => [p.inb, p.out])));
  const y = (v: number) => base - (v / max) * (base - T);
  const bar = (x: number, v: number, color: string) => v > 0 && (
    <g><path d={`M${x} ${base} V${y(v) + 4} q0 -4 4 -4 h${bw - 8} q4 0 4 4 V${base}Z`} fill={color} />
      <text x={x + bw / 2} y={y(v) - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill={R.ink}>{v}</text></g>
  );
  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Inbound and outbound calls per person" style={{ display: "block" }}>
        {[0, max / 2, max].map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="#efe4d3" /><text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill={R.mute}>{v}</text></g>)}
        {people.map((p, i) => {
          const cx = L + (i + 0.5) * gw;
          return (
            <g key={p.key} style={{ cursor: "pointer" }} onClick={() => onPick(p.key)} onMouseEnter={() => setHi(i)}>
              <rect x={cx - gw / 2} y={0} width={gw} height={H} fill={hi === i ? "rgba(140,63,18,.06)" : "transparent"} rx="8" />
              {bar(cx - bw - 1, p.inb, R.in)}{bar(cx + 1, p.out, R.out)}
              <text x={cx} y={base + 18} textAnchor="middle" fontSize="11.5" fontWeight="600" fill={R.ink}>{p.name.split(/\s+/)[0]}</text>
            </g>
          );
        })}
      </svg>
      {hi !== null && <Tip x={((L + (hi + 0.5) * gw) / W) * 100} y={(y(Math.max(people[hi].inb, people[hi].out)) / H) * 100}>
        <b>{people[hi].name}</b> · {people[hi].inb} in · {people[hi].out} out · click to open
      </Tip>}
    </div>
  );
}

/** Calls per length band as columns, hover for the count and share. */
export function LengthColumns({ b }: { b: number[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 480, H = 150, base = H - 24, max = Math.max(...b, 1), bw = W / 8, total = b.reduce((a, v) => a + v, 0) || 1;
  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Calls by length" style={{ display: "block" }}>
        <line x1="0" x2={W} y1={base} y2={base} stroke="#d8c9b3" />
        {b.map((v, i) => {
          const h = (v / max) * (base - 22), x0 = i * bw + 6, w = bw - 12;
          return (
            <g key={i} onMouseEnter={() => setHi(i)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill={hi === i ? "rgba(140,63,18,.06)" : "transparent"} />
              {v > 0 && <path d={`M${x0} ${base} V${base - h + 4} q0 -4 4 -4 h${w - 8} q4 0 4 4 V${base}Z`} fill={R.ramp[i]} />}
              <text x={x0 + w / 2} y={base - h - 6} textAnchor="middle" fontSize="12" fontWeight="700" fill={R.ink}>{v}</text>
              <text x={x0 + w / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={R.mute}>{BUCKETS[i]}</text>
            </g>
          );
        })}
      </svg>
      {hi !== null && <Tip x={((hi + 0.5) * bw / W) * 100} y={((base - (b[hi] / max) * (base - 22)) / H) * 100}><b>{BUCKETS[hi]}</b> · {b[hi]} calls · {pct(b[hi] / total)}</Tip>}
    </div>
  );
}

export function Ring({ frac, size = 104, color, label, track = "#efe4d3", ink = R.ink }: { frac: number; size?: number; color: string; label: string; track?: string; ink?: string }) {
  const c = 2 * Math.PI * 42;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={label} style={{ display: "block", margin: "0 auto" }}>
      <circle cx="50" cy="50" r="42" fill="none" stroke={track} strokeWidth="9" />
      <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${Math.max(0.01, c * frac)} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="57" textAnchor="middle" fontSize="19" fontWeight="800" fill={ink}>{label}</text>
    </svg>
  );
}
