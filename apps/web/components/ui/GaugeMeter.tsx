import { C } from "@/lib/constants";

type Props = {
  value: number;
  label?: string;
};

// Annular arc path: from startPct to endPct (0 = left/9-o'clock, 1 = right/3-o'clock, through top)
function arcBand(
  cx: number, cy: number, r: number, thick: number,
  startPct: number, endPct: number
): string {
  const ri = r - thick;
  const pt = (p: number, radius: number): [number, number] => {
    const a = Math.PI * (1 - p); // 0%=π(left) … 100%=0(right)
    return [cx + radius * Math.cos(a), cy - radius * Math.sin(a)];
  };
  const [x1o, y1o] = pt(startPct, r);
  const [x2o, y2o] = pt(endPct,   r);
  const [x1i, y1i] = pt(startPct, ri);
  const [x2i, y2i] = pt(endPct,   ri);
  const lg = endPct - startPct > 0.5 ? 1 : 0;
  // outer arc: counterclockwise sweep=0  |  inner arc back: clockwise sweep=1
  return `M ${x1o} ${y1o} A ${r} ${r} 0 ${lg} 0 ${x2o} ${y2o} L ${x2i} ${y2i} A ${ri} ${ri} 0 ${lg} 1 ${x1i} ${y1i} Z`;
}

export default function GaugeMeter({ value, label = "Satisfaction Score" }: Props) {
  const pct = Math.max(0, Math.min(100, value));
  const fp  = pct / 100;

  const cx = 110, cy = 96, r = 80, thick = 18;

  // Needle: angle goes from π (0% = left) to 0 (100% = right) through top
  const angle    = Math.PI * (1 - fp);
  const needleL  = r - thick - 10;
  const tip      = [cx + needleL * Math.cos(angle), cy - needleL * Math.sin(angle)];
  const bw       = 3.5; // half-width of needle base
  const b1       = [cx + bw * Math.sin(angle), cy + bw * Math.cos(angle)];
  const b2       = [cx - bw * Math.sin(angle), cy - bw * Math.cos(angle)];

  const color    = pct >= 70 ? C.green : pct >= 40 ? C.orange : C.red;

  // Arc endpoint positions for Low/High labels
  const leftX  = cx - r;   // pct=0
  const rightX = cx + r;   // pct=100

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={220} height={152} viewBox="0 0 220 152">

        {/* ── Background zones (muted) ── */}
        <path d={arcBand(cx, cy, r, thick, 0,   0.4)} fill={C.red}    opacity={0.13} />
        <path d={arcBand(cx, cy, r, thick, 0.4, 0.7)} fill={C.orange} opacity={0.13} />
        <path d={arcBand(cx, cy, r, thick, 0.7, 1.0)} fill={C.green}  opacity={0.13} />

        {/* ── Active fill ── */}
        {fp > 0   && <path d={arcBand(cx, cy, r, thick, 0,   Math.min(fp, 0.4))} fill={C.red}    opacity={0.88} />}
        {fp > 0.4 && <path d={arcBand(cx, cy, r, thick, 0.4, Math.min(fp, 0.7))} fill={C.orange} opacity={0.88} />}
        {fp > 0.7 && <path d={arcBand(cx, cy, r, thick, 0.7, fp)}                fill={C.green}  opacity={0.88} />}

        {/* ── Zone dividers at 40% and 70% ── */}
        {[0.4, 0.7].map((t) => {
          const a  = Math.PI * (1 - t);
          const x1 = cx + (r - thick) * Math.cos(a), y1 = cy - (r - thick) * Math.sin(a);
          const x2 = cx + r            * Math.cos(a), y2 = cy - r            * Math.sin(a);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.card} strokeWidth={3} />;
        })}

        {/* ── Needle ── */}
        <path
          d={`M ${b1[0]} ${b1[1]} L ${tip[0]} ${tip[1]} L ${b2[0]} ${b2[1]} Z`}
          fill={C.text}
          opacity={0.82}
        />

        {/* ── Pivot ── */}
        <circle cx={cx} cy={cy} r={9}   fill={C.text} opacity={0.85} />
        <circle cx={cx} cy={cy} r={4}   fill={C.card} />

        {/* ── Endpoint labels ── */}
        <text x={leftX  - 2} y={cy + 15} textAnchor="middle" fontSize={10} fontWeight={600} fill={C.muted}>Low</text>
        <text x={rightX + 2} y={cy + 15} textAnchor="middle" fontSize={10} fontWeight={600} fill={C.muted}>High</text>

        {/* ── Value — sits in the open space below the pivot ── */}
        <text
          x={cx} y={126}
          textAnchor="middle"
          fontSize={30} fontWeight={800}
          fill={color}
        >
          {pct}%
        </text>

      </svg>

      <p style={{ margin: "-2px 0 0", fontSize: 12, color: C.muted, fontWeight: 600 }}>
        {label}
      </p>
    </div>
  );
}
