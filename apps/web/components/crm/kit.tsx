"use client";

// CRM building blocks, made from the report theme (R) so the CRM reads as the same product
// as Reports / View report: espresso header band, cream cards, beige page, DM Sans.
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { R } from "@/components/report/kit";
import { codeMeta, statusLabel, type Code } from "@/lib/crm";

export const CRM_CSS = `
  .crm-row{transition:background .15s}
  .crm-row:hover{background:${R.soft}}
  .crm-btn{transition:background .15s,box-shadow .15s,opacity .15s}
  .crm-btn:focus-visible,.crm-row:focus-visible{outline:2px solid ${R.gold};outline-offset:2px}
  @keyframes crm-due{0%,100%{background:#fff4dc;box-shadow:inset 4px 0 0 ${R.gold}}50%{background:#fde3b0;box-shadow:inset 4px 0 0 #c4862d}}
  .crm-due{animation:crm-due 1.4s ease-in-out infinite}
  .crm-due-pill{display:none}
  @media (prefers-reduced-motion: reduce){
    .crm-due{animation:none;background:#fde9c2;box-shadow:inset 4px 0 0 ${R.gold}}
    .crm-due-pill{display:inline-block}
    .crm-row,.crm-btn,.crm-drawer{transition:none}
  }
  .crm-g4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  @media (max-width:1100px){.crm-g4{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

const CHIP: Record<string, [string, string]> = {
  retry: ["#efe6d8", R.mute],
  callback: ["#f8ead2", "#8a5a12"],
  paid: ["#e5efe0", R.good],
  closed: ["#f8e3df", R.bad],
};

/** Outcome code letter, coloured by what it means: retry beige, callback gold, paid green, closed red. */
export function CodeChip({ code, big = false, title }: { code: string | null | undefined; big?: boolean; title?: string }) {
  if (!code) return <span style={{ color: "#c2b39c", fontSize: 12 }}>—</span>;
  const m = codeMeta(code);
  const [bg, fg] = CHIP[m?.kind ?? "retry"];
  return (
    <span title={title ?? (m ? `${code}: ${m.label}` : code)}
      style={{ display: "inline-grid", placeItems: "center", minWidth: big ? 30 : 24, height: big ? 30 : 22, padding: "0 6px", borderRadius: 7,
        background: bg, color: fg, fontWeight: 800, fontSize: big ? 15 : 12.5, border: m?.kind === "callback" ? `1px solid ${R.gold}` : "1px solid transparent" }}>
      {code}
    </span>
  );
}

/** A lead's status as on the sheet: code chip + label in the code's colour; "New" has no code yet. */
export function StatusBadge({ l }: { l: { status: string; current_code: Code | null } }) {
  if (l.status === "new" || !l.current_code) return <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: "#e7f0fb", color: "#2563a8" }}>New</span>;
  const [, fg] = CHIP[codeMeta(l.current_code)?.kind ?? "retry"];
  return (
    <span title={codeMeta(l.current_code)?.rule} style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 700, color: l.status === "dropped" ? R.mute : fg }}>
      <CodeChip code={l.current_code} />{statusLabel(l)}
    </span>
  );
}

export function Tag({ children, tone = "neu", title }: { children: ReactNode; tone?: "neu" | "ok" | "bad" | "gold"; title?: string }) {
  const c = { neu: ["#efe6d8", R.mute], ok: ["#e5efe0", R.good], bad: ["#f8e3df", R.bad], gold: ["#f8ead2", "#8a5a12"] }[tone];
  return <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: c[0], color: c[1], whiteSpace: "nowrap" }}>{children}</span>;
}

/** Marks a setting the client still has to confirm (pointed at during the demo). */
const tl: CSSProperties = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", opacity: 0.85, fontWeight: 600 };

/** Translucent KPI tile for the espresso header band. */
export function BandTile({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: string; accent?: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ ...tl, color: accent ?? R.gold, opacity: 1 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, margin: "2px 0 0", color: "#fff" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#e9dccb", opacity: 0.85 }}>{sub}</div>}
    </div>
  );
}

/** The dark band at the top of every CRM page: eyebrow, title, right-side actions, then children (tiles / tabs). */
export function HeaderBand({ eyebrow, title, sub, right, children }: { eyebrow: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <section style={{ background: "linear-gradient(160deg,#3b2a1e,#5a4231 75%,#6f4f35)", color: "#fff", borderRadius: 14, padding: 16, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...tl, color: R.gold, opacity: 1 }}>{eyebrow}</div>
          <h1 style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800 }}>{title}</h1>
          {sub && <div style={{ fontSize: 13, color: "#e9dccb", marginTop: 2 }}>{sub}</div>}
        </div>
        {right && <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Btn({ children, onClick, kind = "primary", disabled, type = "button", title, style }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "light" | "danger" | "good"; disabled?: boolean;
  type?: "button" | "submit"; title?: string; style?: CSSProperties;
}) {
  const k = {
    primary: { background: R.out, color: "#fff", border: "1px solid transparent" },
    good: { background: R.good, color: "#fff", border: "1px solid transparent" },
    danger: { background: R.card, color: R.bad, border: `1px solid #e8c4bd` },
    ghost: { background: R.card, color: R.ink, border: `1px solid ${R.line}` },
    light: { background: "rgba(255,255,255,.1)", color: "#fff", border: "1px solid rgba(255,255,255,.22)" },
  }[kind];
  return (
    <button type={type} className="crm-btn" onClick={onClick} disabled={disabled} title={title}
      style={{ ...k, borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 13.5, fontFamily: "inherit", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, ...style }}>
      {children}
    </button>
  );
}

export const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${R.line}`, borderRadius: 9, padding: "8px 10px", fontSize: 13.5,
  fontFamily: "inherit", color: R.ink, background: "#fff",
};
export const labelStyle: CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: R.mute, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 };
export const thStyle: CSSProperties = { textAlign: "left", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: R.mute, background: R.soft, padding: "9px 10px", fontWeight: 600, whiteSpace: "nowrap" };
export const tdStyle: CSSProperties = { padding: "10px", borderBottom: "1px solid #f1e8da", verticalAlign: "middle" };

/** Right-side sheet over the page; Escape or the backdrop closes it. */
/** Centered pop-up (lead form). Escape or a click on the backdrop closes it; width animates when it grows. */
export function Modal({ open, onClose, children, label, width = 780 }: { open: boolean; onClose: () => void; children: ReactNode; label: string; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: "2vh 2vw" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(43,33,24,.4)" }} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={label} className="crm-drawer"
        style={{ position: "relative", width: `min(${width}px, 96vw)`, maxHeight: "94vh", overflowY: "auto", background: R.page, borderRadius: 18,
          boxShadow: "0 30px 70px -25px rgba(0,0,0,.55)", padding: 18, boxSizing: "border-box", transition: "width .25s ease" }}>
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ children, count, right }: { children: ReactNode; count?: number; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "4px 2px 8px" }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: R.ink }}>{children}</h2>
      {count !== undefined && <span style={{ fontSize: 12.5, color: R.mute, fontWeight: 600 }}>{count}</span>}
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}
