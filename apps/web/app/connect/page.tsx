"use client";

// Test connection (client's PDF, 28 Nov 2026): dial the office's test number from the desk phone and hold it for 10 s.
// The page asks the server every 3 s; the server matches the recording to the line picked. Connected → Start calling
// (the Leads tab). No recording in 3 min → Retry or Try another number. A line someone else holds shows who.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import type { ConnectState, OfficeOption } from "@callflow/shared-types";
import { GlassShell, G, glassButton, glassError } from "@/components/auth/Glass";
import LinePicker from "@/components/auth/LinePicker";

const TOTAL = 180;
const ago = (iso?: string | null) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default function ConnectPage() {
  return <Suspense><Connect /></Suspense>;
}

function Connect() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: st, mutate } = useSWR<ConnectState>("/connect/me", fetcher, { revalidateOnFocus: true });
  // while a test runs, ask every 3 s: the server matches the recording when asked
  useEffect(() => {
    if (st?.status !== "testing") return;
    const t = setInterval(() => void mutate(), 3000);
    return () => clearInterval(t);
  }, [st?.status, mutate]);
  const [problem, setProblem] = useState(params.get("problem") ?? "");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  // the server's seconds left at the moment it answered; the clock ticks down from there (the PC's clock may be off)
  const [base, setBase] = useState({ left: 0, at: 0 });
  useEffect(() => { setBase({ left: st?.session?.seconds_left ?? 0, at: Date.now() }); }, [st]);

  // a smooth countdown between the 3-second checks
  useEffect(() => {
    if (st?.status !== "testing") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [st?.status]);

  const start = async (lineId: string) => {
    setErr(""); setBusy(true);
    try {
      await mutate(await api.post<ConnectState>("/connect/start", { line_id: lineId }), { revalidate: false });
      setPicking(false); setProblem("");
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    window.location.href = "/login/employee";
  };

  if (!st) return <GlassShell subtitle="Test connection"><p style={{ textAlign: "center", color: G.sub }}>Loading…</p></GlassShell>;
  const s = st.session;
  const left = st.status === "testing" ? Math.max(0, base.left - Math.floor((now - base.at) / 1000)) : 0;

  return (
    <GlassShell subtitle="Test connection" width={480}>
      {problem && <Popup message={problem} onClose={() => { setProblem(""); setPicking(true); }} />}

      {(picking || st.status === "none" || st.status === "ended") ? (
        <Picker busy={busy} onPick={start} onCancel={s && st.status !== "ended" ? () => setPicking(false) : undefined}
          title={st.status === "ended" ? `Your connection ended${s?.end_reason ? ` (${s.end_reason})` : ""}. Pick a number to connect again.` : "Pick the number you'll call from."} />
      ) : st.status === "testing" && s ? (
        <Testing s={s} left={left} hint={st.hint} lastUpload={st.office_last_upload_at} />
      ) : st.status === "connected" && s ? (
        <div className="glass-step" style={{ textAlign: "center" }}>
          <Mark ok />
          <h2 style={{ margin: "14px 0 4px", fontSize: 21, color: G.ink }}>You are connected successfully</h2>
          <p style={{ margin: 0, color: G.sub, fontSize: 14.5 }}>
            Line {s.line_number} · <b>{s.calling_number}</b>{s.office ? ` · ${s.office}` : ""}<br />
            {s.connected_at && `since ${fmtClock(s.connected_at)}`}{s.via === "admin" ? " · connected by an admin" : ""}
          </p>
          <button onClick={() => router.push("/dashboard/crm")} style={{ ...glassButton(false, "green"), marginTop: 22 }}>Start calling →</button>
        </div>
      ) : s ? (
        <div className="glass-step" style={{ textAlign: "center" }}>
          <Mark ok={false} />
          <h2 style={{ margin: "14px 0 4px", fontSize: 21, color: G.red }}>Connection not established</h2>
          <p style={{ margin: "0 0 6px", color: G.sub, fontSize: 14.5 }}>
            No test call from line {s.line_number} ({s.calling_number}) reached the server{s.end_reason && s.end_reason !== "no test call arrived" ? ` — ${s.end_reason}` : ""}.
          </p>
          {st.hint && <Hint hint={st.hint} />}
          {!st.hint && <Silence lastUpload={st.office_last_upload_at} office={s.office} />}
          {err && <p role="alert" style={glassError}>{err}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
            <button disabled={busy || !s.line_id} onClick={() => s.line_id && start(s.line_id)} style={glassButton(busy)}>↻ Retry</button>
            <button disabled={busy} onClick={() => setPicking(true)} style={glassButton(busy, "plain")}>Try another number</button>
          </div>
        </div>
      ) : null}

      <p style={{ margin: "20px 0 0", textAlign: "center" }}>
        <button onClick={logout} style={{ background: "none", border: "none", color: G.sub, fontSize: 13, cursor: "pointer" }}>Log out</button>
      </p>
    </GlassShell>
  );
}

function Testing({ s, left, hint, lastUpload }: { s: NonNullable<ConnectState["session"]>; left: number; hint: ConnectState["hint"]; lastUpload?: string | null }) {
  const r = 46, circ = 2 * Math.PI * r, frac = left / TOTAL;
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <div className="glass-step" style={{ textAlign: "center" }}>
      <p style={{ margin: 0, color: G.sub, fontSize: 14, fontWeight: 600 }}>From your desk phone on <b style={{ color: G.ink }}>{s.calling_number}</b> (line {s.line_number}), dial</p>
      <div style={{ margin: "10px auto 6px", fontSize: 34, fontWeight: 800, letterSpacing: 2, color: G.red, fontVariantNumeric: "tabular-nums" }}>{s.test_number}</div>
      <p style={{ margin: "0 0 16px", color: G.sub, fontSize: 14 }}>and hold it for at least <b style={{ color: G.ink }}>10 seconds</b>, then hang up and wait for verification.</p>
      <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto" }} role="timer" aria-label={`${mm} left`}>
        <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="9" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={G.orange} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)} style={{ transition: "stroke-dashoffset 0.25s linear" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <div><div style={{ fontSize: 24, fontWeight: 800, color: G.ink, fontVariantNumeric: "tabular-nums" }}>{mm}</div><div style={{ fontSize: 11, color: G.muted }}>left</div></div>
        </div>
      </div>
      <p style={{ margin: "14px 0 0", fontSize: 13, color: G.muted }}>
        <span className="cf-pulse" aria-hidden>●</span> Waiting for your test call to reach the server. It can take up to a minute after you hang up.
      </p>
      {hint && <Hint hint={hint} />}
      {left < 60 && !hint && <Silence lastUpload={lastUpload} office={s.office} />}
      <style>{`.cf-pulse{color:${G.orange};animation:cfp 1.2s ease-in-out infinite}@keyframes cfp{50%{opacity:.25}}`}</style>
    </div>
  );
}

/** the test call arrived on another line: the desk phone is wired there */
function Hint({ hint }: { hint: NonNullable<ConnectState["hint"]> }) {
  return (
    <p role="status" style={{ margin: "14px 0 0", padding: "10px 12px", borderRadius: 10, fontSize: 13.5, textAlign: "left", color: "#8a4b00", background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.35)" }}>
      ⚠ A test call came in on <b>line {hint.line_number}{hint.calling_number ? ` (${hint.calling_number})` : ""}</b>, not your line. Your phone seems to be wired to that line.
      Ask for the wire to be fixed, or pick that number instead.
    </p>
  );
}

function Silence({ lastUpload, office }: { lastUpload?: string | null; office: string | null }) {
  const when = ago(lastUpload);
  const stale = !lastUpload || Date.now() - new Date(lastUpload).getTime() > 20 * 60_000;
  if (!stale) return null;
  return (
    <p style={{ margin: "12px 0 0", fontSize: 13, color: G.sub }}>
      {when ? `The last recording from ${office ?? "this office"} reached the server ${when}.` : `No recording from ${office ?? "this office"} has reached the server today.`}
      {" "}If the KoreCall box is off or offline, tell an admin: they can connect you by hand.
    </p>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <div aria-hidden style={{ width: 76, height: 76, borderRadius: "50%", margin: "0 auto", display: "grid", placeItems: "center", color: "#fff", fontSize: 38, fontWeight: 900,
      background: ok ? "linear-gradient(135deg,#1f9d55,#34c46e)" : "linear-gradient(135deg,#d9482b,#f06a4b)",
      boxShadow: `0 10px 28px ${ok ? "rgba(31,157,85,0.4)" : "rgba(217,72,43,0.4)"}`, animation: "cfpop 0.35s cubic-bezier(.2,1.4,.5,1) both" }}>
      {ok ? "✓" : "✕"}
      <style>{`@keyframes cfpop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}`}</style>
    </div>
  );
}

function Picker({ title, busy, onPick, onCancel }: { title: string; busy: boolean; onPick: (lineId: string) => void; onCancel?: () => void }) {
  const { data: offices, mutate } = useSWR<OfficeOption[]>("/connect/options", fetcher, { refreshInterval: 10_000 });
  const [officeId, setOfficeId] = useState("");
  const [lineId, setLineId] = useState("");
  useEffect(() => { if (offices && !officeId) setOfficeId(offices.find((o) => o.lines.length)?.id ?? ""); }, [offices, officeId]);
  if (!offices) return <p style={{ textAlign: "center", color: G.sub }}>Loading numbers…</p>;
  return (
    <div className="glass-step" style={{ display: "grid", gap: 14 }}>
      <p style={{ margin: 0, color: G.ink, fontSize: 15, fontWeight: 600, textAlign: "center" }}>{title}</p>
      <LinePicker offices={offices} officeId={officeId} lineId={lineId} onOffice={setOfficeId} onLine={setLineId} />
      <button onClick={() => mutate()} style={{ justifySelf: "start", background: "none", border: "none", color: G.sub, fontSize: 12.5, cursor: "pointer", padding: 0 }}>↻ Refresh numbers</button>
      <div style={{ display: "grid", gridTemplateColumns: onCancel ? "1fr 2fr" : "1fr", gap: 10 }}>
        {onCancel && <button onClick={onCancel} style={glassButton(false, "plain")}>Back</button>}
        <button disabled={busy || !lineId} onClick={() => onPick(lineId)} style={glassButton(busy || !lineId)}>{busy ? "Starting…" : "Test this number →"}</button>
      </div>
    </div>
  );
}

/** "This line is in use by Jaspreet Kaur (1004)" and the like */
function Popup({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="cf-pop" style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16, background: "rgba(20,14,8,0.45)", backdropFilter: "blur(3px)" }}>
      <div style={{ width: "100%", maxWidth: 380, padding: "24px 24px 20px", borderRadius: 20, textAlign: "center", background: "rgba(255,251,245,0.95)", boxShadow: "0 20px 50px rgba(0,0,0,0.4)" }}>
        <div aria-hidden style={{ fontSize: 34 }}>🔒</div>
        <h3 id="cf-pop" style={{ margin: "6px 0 8px", fontSize: 18, color: G.ink }}>Line not available</h3>
        <p style={{ margin: "0 0 18px", fontSize: 14.5, color: G.sub }}>{message}</p>
        <button autoFocus onClick={onClose} style={glassButton()}>Pick another number</button>
      </div>
    </div>
  );
}
