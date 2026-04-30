"use client";

import { useState } from "react";
import { C } from "@/lib/constants";

type BarPoint = { day: string; inbound: number; outbound: number };

type Props = {
  data: BarPoint[];
  height?: number;
  colors?: [string, string];
  labels?: [string, string];
};

export default function BarChart({
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
  const barW = 14;
  const gap = 6;
  const groupW = 2 * barW + gap;
  const colW = groupW + 18;
  const svgW = data.length * colW;

  return (
    <div style={{ position: "relative", overflowX: "auto" }}>
      <svg width={svgW} height={height + 32} style={{ display: "block", minWidth: "100%" }}>
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = (1 - f) * height;
          return (
            <g key={f}>
              <line x1={0} y1={y} x2={svgW} y2={y} stroke={C.border} strokeWidth={0.5} strokeDasharray="3,3" />
              <text x={0} y={y - 3} fontSize={9} fill={C.muted} textAnchor="start">
                {Math.round(max * f)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const groupX = i * colW + 9;
          const isHover = hoverIdx === i;
          return (
            <g key={i}>
              {[d.inbound, d.outbound].map((val, idx) => {
                const barH = max > 0 ? Math.max((val / max) * height, 0) : 0;
                const x = groupX + idx * (barW + gap);
                const y = height - barH;
                return (
                  <rect
                    key={idx}
                    x={x}
                    y={y}
                    width={barW}
                    height={barH}
                    rx={4}
                    fill={colors[idx]}
                    opacity={isHover ? 1 : 0.82}
                    style={{ transition: "opacity 0.15s, y 0.2s, height 0.2s" }}
                  />
                );
              })}

              <rect
                x={groupX - 4}
                y={0}
                width={groupW + 8}
                height={height}
                fill="transparent"
                style={{ cursor: "crosshair" }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />

              <text x={groupX + groupW / 2} y={height + 18} fontSize={11} fill={C.muted} textAnchor="middle">
                {d.day}
              </text>
            </g>
          );
        })}
      </svg>

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
            {data[hoverIdx].day}
          </p>
          <p style={{ margin: "2px 0", fontSize: 12, color: colors[0], fontWeight: 600 }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: colors[0],
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
            {labels[0]}: <strong>{data[hoverIdx].inbound || 0}</strong>
          </p>
          <p style={{ margin: "2px 0", fontSize: 12, color: colors[1], fontWeight: 600 }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: colors[1],
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
            {labels[1]}: <strong>{data[hoverIdx].outbound || 0}</strong>
          </p>
        </div>
      )}

      <div style={{ display: "flex", gap: 18, marginTop: 8 }}>
        {labels.map((label, i) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: colors[i] }} />
            <span style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
