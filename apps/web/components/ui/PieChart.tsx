import { C } from "@/lib/constants";

type Segment = { value: number; color: string; name?: string };

type Props = {
  segments: Segment[];
  size?: number;
  innerRadius?: number; // 0..1 ratio of the radius
  label?: string;
  sublabel?: string;
};

function polarToXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number
) {
  const sOuter = polarToXY(cx, cy, rOuter, startDeg);
  const eOuter = polarToXY(cx, cy, rOuter, endDeg);
  const sInner = polarToXY(cx, cy, rInner, startDeg);
  const eInner = polarToXY(cx, cy, rInner, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M${sInner.x},${sInner.y}`,
    `L${sOuter.x},${sOuter.y}`,
    `A${rOuter},${rOuter} 0 ${large} 1 ${eOuter.x},${eOuter.y}`,
    `L${eInner.x},${eInner.y}`,
    `A${rInner},${rInner} 0 ${large} 0 ${sInner.x},${sInner.y}`,
    "Z",
  ].join(" ");
}

export default function PieChart({
  segments,
  size = 180,
  innerRadius = 0.6,
  label,
  sublabel,
}: Props) {
  const rOuter = size / 2;
  const rInner = Math.max(0, rOuter * innerRadius);
  const cx = rOuter;
  const cy = rOuter;
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;

  let cursor = -90;
  const paths = segments.map((seg) => {
    const angle = (seg.value / total) * 360;
    const start = cursor;
    const end = cursor + angle;
    cursor = end;
    return {
      d: arcPath(cx, cy, rOuter, rInner, start, end),
      color: seg.color,
      value: seg.value,
      name: seg.name,
    };
  });

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} opacity={0.88} />
        ))}
      </svg>
      {(label || sublabel) && (
        <div style={{ position: "absolute", textAlign: "center", pointerEvents: "none" }}>
          {label && (
            <p
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 700,
                color: C.text,
                lineHeight: 1,
                letterSpacing: -0.5,
              }}
            >
              {label}
            </p>
          )}
          {sublabel && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: C.muted, fontWeight: 500 }}>
              {sublabel}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
