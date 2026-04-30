"use client";

import { useState } from "react";
import { C } from "@/lib/constants";

type LinePoint = { day_label: string; inbound: number; outbound: number };

type Props = {
  data: LinePoint[];
  height?: number;
  colors?: [string, string];
  labels?: [string, string];
};

export default function LineChart({
  data,
  height = 160,
  colors = [C.orange, C.green],
  labels = ["Inbound", "Outbound"],
}: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return <p style={{ margin: 0, fontSize: 12, color: C.muted }}>No data</p>;
  }

  const max = Math.max(...data.flatMap((d) => [d.inbound, d.outbound]), 1);
  const W = 100;
  const H = height;

  const xAt = (i: number) => (data.length <= 1 ? 0 : (i / (data.length - 1)) * W);
  const yAt = (v: number) => H - (v / max) * H * 0.85;

  const pts = (key: "inbound" | "outbound") =>
    data.map((d, i) => ({ x: xAt(i), y: yAt(d[key]) }));

  const toPath = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  const toArea = (points: { x: number; y: number }[]) => {
    const line = toPath(points);
    const last = points[points.length - 1];
    const first = points[0];
    return `${line} L${last.x},${H} L${first.x},${H} Z`;
  };

  const series = [
    { key: "inbound" as const, color: colors[0], label: labels[0] },
    { key: "outbound" as const, color: colors[1], label: labels[1] },
  ];

  const hoverX = hoverIdx === null ? null : xAt(hoverIdx);

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: H, overflow: "visible" }}
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`lg-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>

        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={0}
            y1={H * f * 0.85}
            x2={W}
            y2={H * f * 0.85}
            stroke={C.border}
            strokeWidth={0.3}
          />
        ))}

        {series.map((s, i) => (
          <path key={`area-${i}`} d={toArea(pts(s.key))} fill={`url(#lg-${i})`} />
        ))}
        {series.map((s, i) => (
          <path
            key={`line-${i}`}
            d={toPath(pts(s.key))}
            fill="none"
            stroke={s.color}
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {data.map((_, i) => {
          const x = xAt(i);
          return (
            <rect
              key={i}
              x={x - 5}
              y={0}
              width={10}
              height={H}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}

        {hoverIdx !== null &&
          series.map((s, i) => {
            const p = pts(s.key)[hoverIdx];
            return <circle key={`dot-${i}`} cx={p.x} cy={p.y} r={1.5} fill={s.color} stroke="#fff" strokeWidth={0.5} />;
          })}

        {hoverX !== null && (
          <line
            x1={hoverX}
            y1={0}
            x2={hoverX}
            y2={H}
            stroke={C.dim}
            strokeWidth={0.4}
            strokeDasharray="1,1"
          />
        )}
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        {data.map((d, i) => (
          <span key={i} style={{ fontSize: 11, color: C.muted, textAlign: "center", flex: 1 }}>
            {d.day_label}
          </span>
        ))}
      </div>

      {hoverIdx !== null && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: `${Math.min((hoverIdx / data.length) * 100 + 4, 62)}%`,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "8px 12px",
            boxShadow: C.shadowMd,
            pointerEvents: "none",
            zIndex: 10,
            minWidth: 110,
          }}
        >
          <p style={{ margin: "0 0 5px", fontSize: 12, fontWeight: 700, color: C.text }}>
            {data[hoverIdx].day_label}
          </p>
          {series.map((s, i) => (
            <p key={s.key} style={{ margin: "2px 0", fontSize: 12, color: s.color, fontWeight: 600 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: s.color,
                  marginRight: 6,
                  verticalAlign: "middle",
                }}
              />
              {s.label}: <strong>{data[hoverIdx][s.key] || 0}</strong>
            </p>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 18, marginTop: 8 }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
            <span style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
