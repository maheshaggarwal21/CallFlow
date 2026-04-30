"use client";

import { C } from "@/lib/colors";

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}

export default function Pagination({ page, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 4) pages.push("…");
    const start = Math.max(2, page - 1);
    const end   = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 3) pages.push("…");
    pages.push(totalPages);
  }

  const btn = (
    label: string | number,
    target: number,
    active = false,
    disabled = false
  ) => (
    <button
      key={`${label}-${target}`}
      onClick={() => !disabled && onPageChange(target)}
      disabled={disabled}
      style={{
        minWidth: 36, height: 36, padding: "0 10px",
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 8,
        border: active ? "none" : `1px solid ${C.border}`,
        background: active ? C.orange : C.card,
        color: active ? "#fff" : disabled ? C.dim : C.text,
        fontWeight: active ? 700 : 500,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.12s",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {btn("‹ Prev", page - 1, false, page === 1)}
      {pages.map((p, i) =>
        p === "…"
          ? <span key={`ellipsis-${i}`} style={{ color: C.muted, padding: "0 4px", fontSize: 13 }}>…</span>
          : btn(p, p as number, p === page)
      )}
      {btn("Next ›", page + 1, false, page === totalPages)}
    </div>
  );
}
