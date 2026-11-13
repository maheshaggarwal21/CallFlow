"use client";

// Shared look of the salary screens (Employee Tracker): card and text styles, avatar, the eye button.
import Link from "next/link";
import type { CSSProperties } from "react";
import { C, eClr, init } from "@/lib/colors";
import { Icon } from "@/components/crm/icons";

export const S = {
  card:  { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: C.shadow } as CSSProperties,
  h1:    { margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 } as CSSProperties,
  sub:   { margin: "5px 0 0", fontSize: 15, color: C.muted } as CSSProperties,
  label: { fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 } as CSSProperties,
  th:    { fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 1.1, whiteSpace: "nowrap" } as CSSProperties,
  input: {
    width: "100%", padding: "10px 12px", boxSizing: "border-box", background: C.bgDeep,
    border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, color: C.text, outline: "none",
  } as CSSProperties,
  btn: {
    display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10, cursor: "pointer",
    border: `1px solid ${C.border}`, background: C.card, color: C.textSub, fontSize: 13, fontWeight: 600,
  } as CSSProperties,
  btnPrimary: {
    display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", background: C.orange, border: "none",
    borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
    boxShadow: "0 4px 14px rgba(232,118,26,0.32)",
  } as CSSProperties,
};

export function Avatar({ name, colorIndex, size = 44 }: { name: string; colorIndex: number; size?: number }) {
  const clr = eClr(colorIndex);
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.3, flexShrink: 0, background: clr.bg, border: `1px solid ${clr.br}`,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.34, fontWeight: 800, color: clr.t,
    }}>{init(name)}</div>
  );
}

/** The eye: opens one employee's dashboard as they see it. */
export function EyeButton({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/dashboard/salary/${id}`} title={`${name}'s dashboard`} style={{
      ...S.btn, border: `1px solid ${C.orangeBdr}`, color: C.orange, textDecoration: "none",
    }}>
      <Icon name="eye" size={16} /> View
    </Link>
  );
}
