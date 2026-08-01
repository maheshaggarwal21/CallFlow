"use client";

import { C } from "@/lib/colors";
import { PERIODS, type Period } from "@/lib/period";

type Props = {
  period: Period;
  onPeriodChange: (period: Period) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
};

const pillStyle = {
  padding: "8px 12px",
  borderRadius: 20,
  border: `1px solid ${C.border}`,
  background: C.card,
  color: C.text,
  fontSize: 14,
  fontWeight: 600,
  outline: "none",
  boxShadow: C.shadow,
  cursor: "pointer",
} as const;

/**
 * The single period picker used by the dashboard and every employee view, so
 * the presets, the default and the resulting date ranges can't drift apart.
 */
export default function PeriodSelect({
  period,
  onPeriodChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
}: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {period === "custom" && (
        <>
          <input
            type="date"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => onCustomFromChange(e.target.value)}
            aria-label="From date"
            style={pillStyle}
          />
          <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>to</span>
          <input
            type="date"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => onCustomToChange(e.target.value)}
            aria-label="To date"
            style={pillStyle}
          />
        </>
      )}
      <select
        value={period}
        onChange={(e) => onPeriodChange(e.target.value as Period)}
        aria-label="Date range"
        style={{
          ...pillStyle,
          padding: "8px 36px 8px 14px",
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238a8278' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px center",
        }}
      >
        {PERIODS.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}
