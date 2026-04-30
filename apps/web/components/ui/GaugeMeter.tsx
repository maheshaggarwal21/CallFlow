import { C } from "@/lib/constants";

type Props = {
  value: number;
  label?: string;
};

function polarToXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  startDeg: number,
  endDeg: number
) {
  const s = polarToXY(cx, cy, radius, startDeg);
  const e = polarToXY(cx, cy, radius, endDeg);
  const sInner = polarToXY(cx, cy, radius - thickness, startDeg);
  const eInner = polarToXY(cx, cy, radius - thickness, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M${s.x},${s.y}`,
    `A${radius},${radius} 0 ${large} 1 ${e.x},${e.y}`,
    `L${eInner.x},${eInner.y}`,
    `A${radius - thickness},${radius - thickness} 0 ${large} 0 ${sInner.x},${sInner.y}`,
    "Z",
  ].join(" ");
}

export default function GaugeMeter({ value, label = "Satisfaction Score" }: Props) {
  const cx = 90;
  const cy = 90;
  const r = 70;
  const pct = Math.max(0, Math.min(100, value));
  const filled = -140 + (pct / 100) * 280;

  const segments = [
    { start: -140, end: -70, color: "#f59e0b" },
    { start: -70, end: 0, color: "#84cc16" },
    { start: 0, end: 70, color: "#22c55e" },
    { start: 70, end: 140, color: "#16a34a" },
  ];

  const needleRad = (filled * Math.PI) / 180;
  const nx = cx + 55 * Math.cos(needleRad);
  const ny = cy + 55 * Math.sin(needleRad);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={180} height={110} viewBox="0 0 180 110">
        {segments.map((s, i) => (
          <path key={`bg-${i}`} d={arcPath(cx, cy, r, 14, s.start, s.end)} fill={C.bgDeep} opacity={0.6} />
        ))}
        {segments.map((s, i) => {
          const end = Math.min(s.end, filled);
          if (end <= s.start) return null;
          return (
            <path
              key={`fg-${i}`}
              d={arcPath(cx, cy, r, 14, s.start, end)}
              fill={s.color}
              opacity={0.85}
            />
          );
        })}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={C.text} strokeWidth={2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={5} fill={C.text} />
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize={22} fontWeight={700} fill={C.text}>
          {pct}%
        </text>
        <text x={20} y={105} fontSize={9} fill={C.muted}>Low</text>
        <text x={145} y={105} fontSize={9} fill={C.muted}>High</text>
      </svg>
      <p style={{ margin: 0, fontSize: 13, color: C.muted, fontWeight: 500 }}>{label}</p>
    </div>
  );
}
