import { CSSProperties } from "react";
import { C } from "@/lib/colors";

interface Props {
  label: string;
  color?: string;
  bg?: string;
  style?: CSSProperties;
}

export default function Tag({ label, color = C.text, bg = C.bgDeep, style }: Props) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      color,
      background: bg,
      whiteSpace: "nowrap",
      ...style,
    }}>
      {label}
    </span>
  );
}
