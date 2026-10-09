"use client";

import { useEffect, useRef, useState } from "react";
import { C } from "@/lib/colors";
import { canPlayOpus, type PlayChoice } from "@/lib/audioPlayback";

interface Props {
  choice: PlayChoice;
  onChange: (choice: PlayChoice) => void;
  /** What Auto resolves to for this call, e.g. "Opus" or "WAV (original)". */
  autoLabel: string;
}

export default function AudioFormatMenu({ choice, onChange, autoLabel }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const opusOk = canPlayOpus();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options: { value: PlayChoice; title: string; desc: string; disabled?: boolean }[] = [
    { value: "auto", title: "Auto", desc: `Playing ${autoLabel}. Opus, or MP3 if this browser can't play Opus.` },
    {
      value: "opus",
      title: "Opus · 16 kbps",
      desc: opusOk ? "Built for voice — slightly clearer." : "This browser can't play Opus.",
      disabled: !opusOk,
    },
    { value: "mp3", title: "MP3 · 16 kbps", desc: "Plays on every browser and phone." },
  ];

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Playback format"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Playback format"
        style={{
          width: 32, height: 32, borderRadius: 9,
          background: open ? C.orangeLight : C.card,
          border: `1px solid ${open ? C.orangeBdr : C.border}`,
          color: open ? C.orange : C.muted,
          cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >⋯</button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 10,
            width: 260, padding: 6,
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
          }}
        >
          <p style={{
            margin: 0, padding: "6px 10px 8px", fontSize: 11, fontWeight: 700,
            color: C.muted, letterSpacing: 0.6, textTransform: "uppercase",
          }}>Playback format</p>

          {options.map((opt) => {
            const selected = choice === opt.value;
            return (
              <button
                key={opt.value}
                role="menuitemradio"
                aria-checked={selected}
                disabled={opt.disabled}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 8,
                  border: "none", background: selected ? C.orangeLight : "transparent",
                  cursor: opt.disabled ? "not-allowed" : "pointer",
                  opacity: opt.disabled ? 0.55 : 1,
                  display: "flex", gap: 10, alignItems: "flex-start",
                }}
              >
                <span style={{ width: 14, flexShrink: 0, color: C.orange, fontSize: 13, fontWeight: 700 }}>
                  {selected ? "✓" : ""}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{opt.title}</span>
                  <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{opt.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
