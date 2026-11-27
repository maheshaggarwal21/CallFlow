"use client";

// Employee login (client's PDF, 28 Nov 2026): Reg No → Get details shows the name and the phone as 98******66 →
// Next → office and calling number → password → Login, then the test connection page. Each step stays on screen.
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { OfficeOption } from "@callflow/shared-types";
import { GlassShell, G, glassButton, glassError, glassField, glassLabel, glassValue } from "@/components/auth/Glass";
import LinePicker from "@/components/auth/LinePicker";

type Lookup = { name: string; phone_masked: string; home_office_id: string | null; offices: OfficeOption[] };

export default function EmployeeLoginPage() {
  return <Suspense><EmployeeLogin /></Suspense>;
}

function EmployeeLogin() {
  const router = useRouter();
  const idle = useSearchParams().get("idle") === "1";
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [reg, setReg] = useState("");
  const [who, setWho] = useState<Lookup | null>(null);
  const [officeId, setOfficeId] = useState("");
  const [lineId, setLineId] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (f: () => Promise<void>) => {
    setErr(""); setBusy(true);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const getDetails = () => run(async () => {
    const r = await api.post<Lookup>("/auth/employee/lookup", { reg_no: reg.trim() });
    setWho(r);
    // start on their own office when it has numbers, else the first office (reps move between offices)
    const home = r.offices.find((o) => o.id === r.home_office_id && o.lines.length) ?? r.offices.find((o) => o.lines.length) ?? r.offices[0];
    setOfficeId(home?.id ?? "");
    setLineId("");
    setStep(2);
  });

  const refreshLines = () => run(async () => { setWho(await api.post<Lookup>("/auth/employee/lookup", { reg_no: reg.trim() })); });

  const login = () => run(async () => {
    const r = await api.post<{ problem: { message: string } | null }>("/auth/employee/login", { reg_no: reg.trim(), password, line_id: lineId });
    router.push(r.problem ? `/connect?problem=${encodeURIComponent(r.problem.message)}` : "/connect");
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) { if (!/^\d+$/.test(reg.trim())) return setErr("Type your Reg No (numbers only)."); return getDetails(); }
    if (step === 2) return setStep(3);
    if (step === 3) { if (!lineId) return setErr("Pick the calling number you'll call from."); setErr(""); return setStep(4); }
    if (!password) return setErr("Type your password.");
    return login();
  };

  const label = { 1: busy ? "Finding you…" : "Get details", 2: "Next", 3: "Next", 4: busy ? "Signing in…" : "Login" }[step];

  return (
    <GlassShell subtitle="Employee login">
      {idle && step === 1 && (
        <p role="status" style={{ margin: "0 0 14px", padding: "10px 12px", borderRadius: 10, fontSize: 13.5, color: "#8a4b00", background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.35)" }}>
          You were logged out after 45 minutes with no activity, and your line was freed. Log in again to connect.
        </p>
      )}
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
        <label>
          <span style={glassLabel}>Reg No</span>
          <input value={reg} inputMode="numeric" autoFocus autoComplete="username" placeholder="e.g. 1004" maxLength={9}
            onChange={(e) => { setReg(e.target.value.replace(/\D/g, "")); if (step > 1) { setStep(1); setWho(null); } setErr(""); }}
            style={{ ...glassField, textAlign: "center", fontSize: 18, fontWeight: 700, letterSpacing: 2 }} />
        </label>

        {who && step >= 2 && (
          <div className="glass-step" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ minWidth: 0 }}><span style={glassLabel}>Name</span><div style={{ ...glassValue, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who.name}</div></label>
            <label style={{ minWidth: 0 }}><span style={glassLabel}>Contact</span><div style={{ ...glassValue, letterSpacing: 1 }}>{who.phone_masked || "—"}</div></label>
          </div>
        )}

        {who && step >= 3 && (
          <div className="glass-step">
            <LinePicker offices={who.offices} officeId={officeId} lineId={lineId} onOffice={setOfficeId} onLine={(id) => { setLineId(id); setErr(""); if (step > 3) setStep(3); }} />
            <button type="button" onClick={refreshLines} style={{ marginTop: 6, background: "none", border: "none", color: G.sub, fontSize: 12.5, cursor: "pointer", padding: 0 }}>↻ Refresh numbers</button>
          </div>
        )}

        {step >= 4 && (
          <label className="glass-step">
            <span style={glassLabel}>Enter password</span>
            <div style={{ position: "relative" }}>
              <input type={showPwd ? "text" : "password"} value={password} autoFocus autoComplete="current-password" placeholder="••••••••"
                onChange={(e) => { setPassword(e.target.value); setErr(""); }} style={{ ...glassField, paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? "Hide password" : "Show password"}
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 15, padding: 0 }}>
                {showPwd ? "🙈" : "👁"}
              </button>
            </div>
          </label>
        )}

        {err && <p role="alert" style={glassError}>{err}</p>}
        <button type="submit" disabled={busy} style={{ ...glassButton(busy), marginTop: 4 }}>{label} {!busy && "→"}</button>
      </form>

      <p style={{ margin: "18px 0 0", fontSize: 13, textAlign: "center", color: G.sub }}>
        Admin? <Link href="/login" style={{ color: G.orange, fontWeight: 700, textDecoration: "none" }}>Staff login with email</Link>
      </p>
    </GlassShell>
  );
}
