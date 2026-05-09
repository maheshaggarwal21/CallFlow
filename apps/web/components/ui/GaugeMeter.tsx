import { C } from "@/lib/constants";

type Props = {
  value: number;
  label?: string;
};

export default function GaugeMeter({ value, label = "Satisfaction Score" }: Props) {
  const pct = Math.max(0, Math.min(100, value));

  // Semicircle arc via stroke-dasharray on a full circle.
  // rotate(180 cx cy) shifts the start point from 3 o'clock → 9 o'clock so the
  // visible arc runs left → top → right (the clean top half of the circle).
  const cx = 100, cy = 95, r = 66;
  const fullC = 2 * Math.PI * r;
  const halfC = Math.PI * r;           // arc length of the semicircle track
  const filledLen = (pct / 100) * halfC;

  const color = pct >= 70 ? C.green : pct >= 40 ? C.orange : C.red;
  const bgColor = C.bgDeep;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg
        width={200} height={112}
        viewBox="0 0 200 112"
        style={{ overflow: "visible" }}
      >
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={bgColor}
          strokeWidth={18}
          strokeDasharray={`${halfC} ${fullC}`}
          strokeLinecap="round"
          transform={`rotate(180 ${cx} ${cy})`}
        />

        {/* Fill */}
        {pct > 0 && (
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={color}
            strokeWidth={18}
            strokeDasharray={`${filledLen} ${fullC}`}
            strokeLinecap="round"
            transform={`rotate(180 ${cx} ${cy})`}
          />
        )}

        {/* Percentage */}
        <text
          x={cx} y={72}
          textAnchor="middle"
          fontSize={30} fontWeight={800}
          fill={color}
        >
          {pct}%
        </text>

        {/* Endpoint labels */}
        <text x={18} y={cy + 12} fontSize={10} fontWeight={600} fill={C.muted}>Low</text>
        <text x={182} y={cy + 12} fontSize={10} fontWeight={600} fill={C.muted} textAnchor="end">High</text>
      </svg>

      <p style={{ margin: "-4px 0 0", fontSize: 12, color: C.muted, fontWeight: 600 }}>{label}</p>
    </div>
  );
}
