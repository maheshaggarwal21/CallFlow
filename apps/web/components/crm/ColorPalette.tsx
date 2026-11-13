"use client";

// Colour of a code in CRM Settings (client, 13 Nov 2026): one palette button; its menu has a grid of
// colours plus "More colours" for any shade, and nothing changes until Select is pressed.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { R } from "@/components/report/kit";
import { inkOn } from "@/lib/crm";

// one column per hue, light → dark; the third shade of each is one of the old named colours
const GRID = [
  ["#f8b4b4", "#e86a6a", "#d64545", "#9b2c2c"], ["#fbc99d", "#f39a4c", "#e8761a", "#a8500f"],
  ["#fbe38e", "#f2c94c", "#e0a800", "#9a7400"], ["#b5e3c4", "#5cc085", "#2f9e5b", "#1d6b3c"],
  ["#a7e3de", "#3cbdb3", "#0f9d94", "#0a6660"], ["#b3cdf5", "#6b9ae6", "#2f6fd6", "#1e4a94"],
  ["#cdb9f0", "#9f7ae0", "#7b4fd0", "#523391"], ["#f6b8d6", "#e57bb0", "#d6478f", "#942d61"],
  ["#e2c6a8", "#b98557", "#8a5a2b", "#5e3c1c"], ["#d1d5db", "#9ca3af", "#6b7280", "#374151"],
];
const W = 300;

export default function ColorPalette({ code, value, onSelect }: { code: string; value?: string; onSelect: (color: string | undefined) => void }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<string | undefined>(value);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    // fixed, so the table's scroll box can't clip it; flips above the button near the bottom of the screen
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)), top: r.bottom + 330 > window.innerHeight ? Math.max(8, r.top - 326) : r.bottom + 6 });
    setDraft(value);
  };
  const close = () => setAt(null);

  useEffect(() => {
    if (!at) return;
    const onDown = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); btn.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  const chip = (c: string | undefined): CSSProperties => ({ display: "inline-grid", placeItems: "center", minWidth: 30, height: 30, padding: "0 6px", borderRadius: 7,
    fontWeight: 800, fontSize: 15, background: c ?? "#ece7df", color: c ? inkOn(c) : R.mute });

  return (
    <>
      <button ref={btn} type="button" onClick={() => (at ? close() : open())} aria-haspopup="dialog" aria-expanded={!!at} aria-label={`Colour of code ${code}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "5px 12px 5px 6px", borderRadius: 10, border: `1px solid ${at ? R.out : R.line}`,
          background: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: R.ink }}>
        <span style={chip(value)}>{code}</span>
        <span aria-hidden style={{ width: 16, height: 16, borderRadius: 5, background: "conic-gradient(#d64545,#e0a800,#2f9e5b,#0f9d94,#2f6fd6,#7b4fd0,#d6478f,#d64545)" }} />
        Palette
      </button>
      {at && (
        <div ref={menu} role="dialog" aria-label={`Pick a colour for code ${code}`}
          style={{ position: "fixed", top: at.top, left: at.left, width: W, zIndex: 50, background: "#fff", border: `1px solid ${R.line}`, borderRadius: 14,
            boxShadow: "0 18px 40px -16px rgba(43,33,24,.35)", padding: 14, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${GRID.length}, 1fr)`, gridAutoFlow: "column", gridTemplateRows: "repeat(4, auto)", gap: 5 }}>
            {GRID.flat().map((c) => (
              <button key={c} type="button" onClick={() => setDraft(c)} aria-label={c} aria-pressed={draft === c} title={c}
                style={{ aspectRatio: "1", borderRadius: 6, background: c, cursor: "pointer", padding: 0,
                  border: draft === c ? `2px solid ${R.ink}` : "2px solid transparent", boxShadow: draft === c ? "inset 0 0 0 2px #fff" : "none" }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: `1px solid ${R.line}`,
              fontSize: 12.5, fontWeight: 700, color: R.ink, cursor: "pointer" }}>
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: 4, background: "conic-gradient(#d64545,#e0a800,#2f9e5b,#0f9d94,#2f6fd6,#7b4fd0,#d6478f,#d64545)" }} />
              More colours
              {/* the browser's own picker for any shade; it only changes the draft */}
              <input type="color" aria-label="Any colour" value={draft ?? "#e8761a"} onChange={(e) => setDraft(e.target.value)}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: 0, padding: 0 }} />
            </label>
            <button type="button" onClick={() => setDraft(undefined)} aria-pressed={!draft}
              style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${!draft ? R.ink : R.line}`, background: "#fff", fontSize: 12.5, fontWeight: 700, color: R.mute, cursor: "pointer", fontFamily: "inherit" }}>
              No colour</button>
            <span style={{ ...chip(draft), marginLeft: "auto" }} aria-label={`Preview: ${draft ?? "no colour"}`}>{code}</span>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={close}
              style={{ padding: "8px 14px", borderRadius: 10, border: `1px solid ${R.line}`, background: "#fff", fontWeight: 700, fontSize: 13, color: R.ink, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button type="button" onClick={() => { onSelect(draft); close(); btn.current?.focus(); }}
              style={{ padding: "8px 18px", borderRadius: 10, border: 0, background: R.out, fontWeight: 700, fontSize: 13, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Select</button>
          </div>
        </div>
      )}
    </>
  );
}
