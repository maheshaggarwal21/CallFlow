"use client";

// The frosted-glass frame of the sign-in pages (client, 28 Nov 2026): the school photo, blurred, behind a translucent
// card in the site's warm colours. Staff login, Employee login and Test connection share it.
import type { CSSProperties, ReactNode } from "react";

export const G = {
  ink: "#1a1209",
  sub: "#6b5a46",
  muted: "#9a8470",
  orange: "#e8761a",
  red: "#d9482b",
  green: "#1f9d55",
  line: "rgba(255,255,255,0.55)",
};

export const glassLabel: CSSProperties = { display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: G.sub, textTransform: "uppercase", letterSpacing: 0.8 };

export const glassField: CSSProperties = {
  width: "100%", padding: "12px 14px", boxSizing: "border-box", fontSize: 15, color: G.ink,
  background: "rgba(255,255,255,0.55)", border: `1.5px solid ${G.line}`, borderRadius: 12, outline: "none",
  boxShadow: "inset 0 1px 2px rgba(26,18,9,0.06)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
};

/** read-only value in a step already done (name, contact) */
export const glassValue: CSSProperties = { ...glassField, background: "rgba(255,255,255,0.32)", color: G.ink, fontWeight: 700 };

export const glassButton = (disabled = false, tone: "orange" | "green" | "red" | "plain" = "orange"): CSSProperties => ({
  width: "100%", padding: "13px 0", borderRadius: 12, fontWeight: 700, fontSize: 15, letterSpacing: 0.2,
  cursor: disabled ? "not-allowed" : "pointer", transition: "transform 0.12s, box-shadow 0.15s",
  ...(tone === "plain"
    ? { background: "rgba(255,255,255,0.5)", color: G.ink, border: `1.5px solid ${G.line}` }
    : {
        color: "#fff", border: "none",
        background: disabled ? "#c8a880" : { orange: "linear-gradient(135deg,#e8761a,#f59e0b)", green: "linear-gradient(135deg,#1f9d55,#34c46e)", red: "linear-gradient(135deg,#d9482b,#f06a4b)" }[tone],
        boxShadow: disabled ? "none" : `0 6px 20px ${{ orange: "rgba(232,118,26,0.38)", green: "rgba(31,157,85,0.35)", red: "rgba(217,72,43,0.35)" }[tone]}`,
      }),
});

export const glassError: CSSProperties = { margin: 0, padding: "10px 12px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: G.red, background: "rgba(217,72,43,0.10)", border: "1px solid rgba(217,72,43,0.25)" };

export function GlassShell({ children, width = 440, subtitle = "Max Music School — Sign in to continue" }: { children: ReactNode; width?: number; subtitle?: string }) {
  return (
    <div style={{ minHeight: "100vh", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", overflow: "hidden", background: "#f7f5f0" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "url('/images/your-image.jpg')", backgroundSize: "cover", backgroundPosition: "center 35%", filter: "blur(3px) brightness(0.62)", transform: "scale(1.05)" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(247,242,232,0.20) 0%, rgba(20,14,8,0.50) 100%)" }} />
      <div className="glass-card" style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: width, boxSizing: "border-box",
        background: "linear-gradient(160deg, rgba(255,251,245,0.80), rgba(252,246,236,0.66))",
        backdropFilter: "blur(22px) saturate(160%)", WebkitBackdropFilter: "blur(22px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.55)", borderRadius: 26, padding: "36px 40px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.7)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ width: 52, height: 52, background: "linear-gradient(135deg,#e8761a,#f59e0b)", borderRadius: 15, margin: "0 auto 12px",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "#fff", boxShadow: "0 6px 18px rgba(232,118,26,0.38)" }}>♪</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: G.ink, letterSpacing: -0.4 }}>CallFlow</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: G.sub, fontWeight: 500 }}>{subtitle}</p>
        </div>
        {children}
      </div>
      <style>{`
        @media (max-width: 480px) { .glass-card { padding: 28px 20px !important; border-radius: 20px !important; } }
        .glass-card input:focus, .glass-card select:focus, .glass-card [role=combobox]:focus-visible { border-color: ${G.orange} !important; box-shadow: 0 0 0 3px rgba(232,118,26,0.18) !important; }
        .glass-card button:not(:disabled):hover { transform: translateY(-1px); }
        @keyframes glassIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .glass-step { animation: glassIn 0.25s ease both; }
      `}</style>
    </div>
  );
}
