import { C } from "@/lib/colors";
import { CSSProperties, ReactNode } from "react";

interface Props {
  label: string;
  value: string | number;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: string;
  style?: CSSProperties;
}

export default function StatCard({ label, value, sub, icon, accent = C.orange, style }: Props) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: "24px 26px",
      boxShadow: C.shadow,
      ...style,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        {icon && (
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: accent + "18",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20,
          }}>
            {icon}
          </div>
        )}
      </div>
      <p style={{ margin: "0 0 6px", fontSize: 13, color: C.muted, fontWeight: 500, letterSpacing: 0.2 }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 34, fontWeight: 700, color: C.text, lineHeight: 1, letterSpacing: -1 }}>
        {value}
      </p>
      {sub && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: C.muted, fontWeight: 400 }}>
          {sub}
        </p>
      )}
    </div>
  );
}
