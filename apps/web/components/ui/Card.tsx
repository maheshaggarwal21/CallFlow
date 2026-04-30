import { C } from "@/lib/colors";
import { CSSProperties, ReactNode } from "react";

interface Props {
  children: ReactNode;
  style?: CSSProperties;
  padding?: number | string;
}

export default function Card({ children, style, padding = "24px 28px" }: Props) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 20,
      padding,
      boxShadow: C.shadow,
      ...style,
    }}>
      {children}
    </div>
  );
}
