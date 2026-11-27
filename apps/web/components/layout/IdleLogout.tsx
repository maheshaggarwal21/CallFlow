"use client";

// Idle logout for anyone connected to a line (client, 28 Nov 2026): 45 minutes with no touch on CallFlow and no call
// recorded on their line → "Are you there?" with a 1-minute countdown. Cancel = still here; OK or the countdown running
// out = log out, which frees the line. Touches in any CallFlow tab count (shared through localStorage); the server is
// pinged at most once a minute so it can free the line of a closed page (apps/api lineSession.service.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { C } from "@/lib/colors";

const IDLE_MS = 45 * 60_000;
const WARN_S = 60;
const PING_MS = 60_000;
const KEY = "cf-last-touch";
// no "scroll": pages scroll themselves (Leads jumps to due follow-ups), which isn't the rep working
const EVENTS = ["mousedown", "keydown", "wheel", "touchstart", "mousemove"] as const;

const readShared = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
const writeShared = (t: number) => { try { localStorage.setItem(KEY, String(t)); } catch { /* private window: this tab only */ } };

export default function IdleLogout() {
  const { connection } = useAuth();
  const on = !!connection;
  const last = useRef(Date.now());
  const lastPing = useRef(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const warning = deadline !== null;

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    window.location.href = "/login/employee?idle=1";
  }, []);

  const touch = useCallback((force = false) => {
    const t = Date.now();
    last.current = t;
    writeShared(t);
    if (force || t - lastPing.current > PING_MS) {
      lastPing.current = t;
      api.post("/connect/seen", { touched: true }).catch(() => {});
    }
  }, []);

  // touches; ignored while the question is up, so only its buttons answer it
  useEffect(() => {
    if (!on || warning) return;
    const h = () => touch();
    EVENTS.forEach((e) => window.addEventListener(e, h, { passive: true, capture: true }));
    const other = (e: StorageEvent) => { if (e.key === KEY && e.newValue) last.current = Math.max(last.current, Number(e.newValue)); };
    window.addEventListener("storage", other);
    return () => { EVENTS.forEach((e) => window.removeEventListener(e, h, { capture: true })); window.removeEventListener("storage", other); };
  }, [on, warning, touch]);

  // every 15 s: idle long enough? ask the server first, a call on the line may have come in
  useEffect(() => {
    if (!on || warning) return;
    const t = setInterval(async () => {
      const mine = Math.max(last.current, readShared());
      if (Date.now() - mine < IDLE_MS) return;
      try {
        const r = await api.post<{ connected: boolean; idle_secs: number | null }>("/connect/seen", { touched: false });
        if (!r.connected) { window.location.href = "/connect"; return; }
        // a call on the line, or a touch on another device, since: count from then
        if (r.idle_secs !== null && r.idle_secs * 1000 < IDLE_MS) { last.current = Date.now() - r.idle_secs * 1000; return; }
      } catch { /* offline: ask anyway */ }
      setNow(Date.now());
      setDeadline(Date.now() + WARN_S * 1000);
    }, 15_000);
    return () => clearInterval(t);
  }, [on, warning]);

  useEffect(() => {
    if (!warning) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [warning]);

  const left = warning ? Math.max(0, Math.ceil((deadline - now) / 1000)) : WARN_S;
  useEffect(() => { if (warning && left === 0) void logout(); }, [warning, left, logout]);

  if (!on || !warning) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="idle-h" aria-describedby="idle-p"
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 16, background: "rgba(20,14,8,0.45)", backdropFilter: "blur(4px)" }}>
      <div style={{ width: "100%", maxWidth: 400, background: C.card, borderRadius: 20, padding: "26px 24px 20px", textAlign: "center", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
        <div aria-hidden style={{ width: 64, height: 64, margin: "0 auto 10px", borderRadius: "50%", display: "grid", placeItems: "center",
          background: C.orangeLight, color: C.orange, fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{left}</div>
        <h2 id="idle-h" style={{ margin: 0, fontSize: 20, color: C.text }}>Are you there?</h2>
        <p id="idle-p" style={{ margin: "8px 0 20px", fontSize: 14.5, color: C.textSub }}>
          There has been no work on CallFlow for 45 minutes. You'll be logged out in <b>{left} s</b> and your line {connection.line_number} will be freed.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button autoFocus onClick={() => { setDeadline(null); touch(true); }}
            style={{ padding: "11px 0", borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.card, color: C.text, fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={() => void logout()}
            style={{ padding: "11px 0", borderRadius: 12, border: "none", background: C.orange, color: "#fff", fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}>
            OK
          </button>
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: C.muted }}>Cancel keeps you logged in · OK logs you out now</p>
      </div>
    </div>
  );
}
