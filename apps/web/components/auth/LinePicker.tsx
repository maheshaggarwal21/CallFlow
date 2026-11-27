"use client";

// Office and calling number dropdowns for the employee login and the test page (client, 28 Nov 2026). The numbers are
// the picked office's. A number someone is connected on shows their initial in their colour, blurred, and can't be
// picked; one being tested says so.
import { useEffect, useRef, useState } from "react";
import type { OfficeOption, LineOption } from "@callflow/shared-types";
import { eClr } from "@/lib/colors";
import { G, glassField, glassLabel } from "./Glass";

const holderColor = (l: LineOption) => l.holder?.color || eClr(l.holder?.color_index ?? 0).t;
const taken = (l: LineOption) => !!l.holder || !!l.testing;

export default function LinePicker({ offices, officeId, lineId, onOffice, onLine }: {
  offices: OfficeOption[]; officeId: string; lineId: string; onOffice: (id: string) => void; onLine: (id: string) => void;
}) {
  const office = offices.find((o) => o.id === officeId);
  const lines = office?.lines ?? [];
  const picked = lines.find((l) => l.id === lineId);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (l: LineOption) => { if (!taken(l)) { onLine(l.id); setOpen(false); } };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((i) => Math.min(lines.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1))));
    }
    if ((e.key === "Enter" || e.key === " ") && open && lines[active]) { e.preventDefault(); choose(lines[active]); }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <label>
        <span style={glassLabel}>Select office</span>
        <select value={officeId} onChange={(e) => { onOffice(e.target.value); onLine(""); }} style={{ ...glassField, appearance: "auto" }}>
          <option value="" disabled>Pick your office…</option>
          {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>

      <div ref={box} style={{ position: "relative" }}>
        <span id="cn-label" style={glassLabel}>Select calling number</span>
        <div role="combobox" tabIndex={office ? 0 : -1} aria-labelledby="cn-label" aria-expanded={open} aria-controls="cn-list" aria-disabled={!office}
          onClick={() => office && setOpen((v) => !v)} onKeyDown={key}
          style={{ ...glassField, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: office ? "pointer" : "not-allowed", opacity: office ? 1 : 0.6, minHeight: 48 }}>
          {picked
            ? <span><b style={{ letterSpacing: 0.3 }}>{picked.calling_number || "No number"}</b> <span style={{ color: G.muted, fontSize: 13 }}>· Line {picked.line_number}</span></span>
            : <span style={{ color: G.muted }}>{office ? (lines.length ? "Pick the number you'll call from…" : "This office has no numbers yet") : "Pick the office first"}</span>}
          <span aria-hidden style={{ color: G.sub, fontSize: 12, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
        </div>
        {open && (
          <div id="cn-list" role="listbox" aria-labelledby="cn-label" style={{
            position: "absolute", zIndex: 5, left: 0, right: 0, top: "calc(100% + 6px)", maxHeight: 260, overflowY: "auto", padding: 6,
            background: "rgba(255,251,245,0.985)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            border: "1px solid rgba(255,255,255,0.7)", borderRadius: 14, boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
          }}>
            {lines.length === 0 && <div style={{ padding: 12, color: G.muted, fontSize: 14 }}>No calling numbers in this office yet.</div>}
            {lines.map((l, i) => {
              const off = taken(l);
              const tip = l.holder ? `In use${l.holder.name ? ` by ${l.holder.name}${l.holder.reg_no ? ` (${l.holder.reg_no})` : ""}` : ""}` : l.testing ? `Being tested${typeof l.testing === "string" ? ` by ${l.testing}` : ""}` : "";
              return (
                <div key={l.id} role="option" aria-selected={l.id === lineId} aria-disabled={off} title={tip || undefined}
                  onMouseEnter={() => setActive(i)} onClick={() => choose(l)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 10, cursor: off ? "not-allowed" : "pointer",
                    background: i === active && !off ? "rgba(232,118,26,0.12)" : l.id === lineId ? "rgba(232,118,26,0.08)" : "transparent" }}>
                  <span style={{ flex: 1, minWidth: 0, opacity: off ? 0.55 : 1 }}>
                    <b style={{ color: G.ink, letterSpacing: 0.3 }}>{l.calling_number || "No number"}</b>
                    <span style={{ color: G.muted, fontSize: 13 }}> · Line {l.line_number}</span>
                    {tip && <span style={{ display: "block", fontSize: 12, color: G.sub }}>{tip}</span>}
                    {l.mine && <span style={{ display: "block", fontSize: 12, color: G.green, fontWeight: 700 }}>Your line</span>}
                  </span>
                  {l.holder && (
                    <span aria-label={tip} style={{ width: 28, height: 28, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center",
                      background: holderColor(l), color: "#fff", fontWeight: 800, fontSize: 13, filter: "blur(0.6px)", opacity: 0.75,
                      boxShadow: `0 0 0 3px ${holderColor(l)}33` }}>{l.holder.initial}</span>
                  )}
                  {!l.holder && l.testing && <span aria-hidden style={{ fontSize: 16 }}>⏳</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
