"use client";

// The lead drawer: claim the soft lock, read the number out, fill the form, save.
// Left: number, WhatsApp, questions, outcome code, reason, note, callback. Right: snapshot + history.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Panel, R } from "@/components/report/kit";
import { API_BASE, api, fetcher } from "@/lib/api";
import { CODES, MIN_NOTE, STATUS_LABEL, fillVars, groupPhone, type Code, type CrmConfig, type LeadDetail } from "@/lib/crm";
import { Btn, CodeChip, Drawer, Tag, inputStyle, labelStyle } from "./kit";
import { useCrmMe } from "@/hooks/useCrmMe";
import { History, Snapshot } from "./History";

const HEARTBEAT_MS = 60_000;
const IDLE_MS = 2 * 60_000;

type Lock = { mine: boolean; locked_by_name: string | null } | null;

function istToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
const fmtChipDate = (d: string) => (d ? new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "");
const fmtChipTime = (t: string) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export default function LeadDrawer({ leadId, onClose, onSaved, isOwner }: { leadId: string | null; onClose: () => void; onSaved: (msg: string) => void; isOwner: boolean }) {
  return (
    <Drawer open={!!leadId} onClose={onClose} label="Lead">
      {leadId && <DrawerBody key={leadId} leadId={leadId} onClose={onClose} onSaved={onSaved} isOwner={isOwner} />}
    </Drawer>
  );
}

function DrawerBody({ leadId, onClose, onSaved, isOwner }: { leadId: string; onClose: () => void; onSaved: (msg: string) => void; isOwner: boolean }) {
  const { data: d, error, mutate } = useSWR<LeadDetail>(`/crm/leads/${leadId}`, fetcher, { refreshInterval: 30_000 });
  const { data: cfg } = useSWR<CrmConfig>("/crm/config", fetcher);
  const [lock, setLock] = useState<Lock>(null);
  const lastActive = useRef(Date.now());
  const { can } = useCrmMe();
  const [reviveErr, setReviveErr] = useState("");

  // Claim on open, extend every minute while the rep is active, release on close
  useEffect(() => {
    let alive = true;
    const claim = () => api.post<Lock>(`/crm/leads/${leadId}/lock`).then((l) => alive && setLock(l)).catch(() => {});
    // Short delay: a mount that is immediately undone (React StrictMode, fast close) must not
    // claim, or its release can land after the real claim and free the lock. The heartbeat
    // below re-claims within a minute if a release ever does win the race.
    const first = setTimeout(claim, 300);
    const t = setInterval(() => { if (Date.now() - lastActive.current < IDLE_MS) claim(); }, HEARTBEAT_MS);
    const bump = () => { lastActive.current = Date.now(); };
    window.addEventListener("keydown", bump);
    window.addEventListener("pointermove", bump);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("pointermove", bump);
      // keepalive so the release still goes out when the tab is closing
      fetch(`${API_BASE}/crm/leads/${leadId}/lock`, { method: "DELETE", credentials: "include", keepalive: true }).catch(() => {});
    };
  }, [leadId]);

  if (error) return <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p>;
  if (!d || !cfg) return <p style={{ color: R.mute }}>Loading lead…</p>;
  const readOnly = lock !== null && !lock.mine;
  const l = d.lead;

  return (
    <div style={{ display: "grid", gap: 14, color: R.ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: R.out, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 11 }}>
            {l.lead_code} · {l.campaign ?? l.source ?? "Lead"}
          </div>
          <h2 style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {l.name || "Unnamed lead"} <CodeChip code={l.current_code} big />
            <Tag>{STATUS_LABEL[l.status] ?? l.status}</Tag>
            {l.tags?.includes("re-enquired") && <Tag tone="gold">re-enquired</Tag>}
          </h2>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {l.status === "dropped" && can("reassign_leads") && (
            <Btn kind="ghost" title="Back into the queue as a retry, attempts reset"
              onClick={() => api.post(`/crm/leads/${l.id}/revive`).then(() => { setReviveErr(""); mutate(); }, (e) => setReviveErr((e as Error).message))}>↺ Revive lead</Btn>
          )}
          <Btn kind="ghost" onClick={onClose}>Close ✕</Btn>
        </div>
      </div>
      {reviveErr && <p role="alert" style={{ margin: 0, color: R.bad, fontSize: 13 }}>{reviveErr}</p>}
      {readOnly && (
        <div role="status" style={{ background: "#fff1d6", border: `1px solid ${R.gold}`, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, fontWeight: 600 }}>
          🔒 {lock?.locked_by_name} is on this lead. You can read it, but the form is read-only until they save or close.
        </div>
      )}
      <div className="crm-drawer-grid">
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <NumberPanel phone={l.phone10} email={l.email} />
          <WhatsAppPanel d={d} cfg={cfg} readOnly={readOnly} onSent={() => mutate()} />
          <OutcomeForm d={d} cfg={cfg} readOnly={readOnly} onSaved={(m) => { mutate(); onSaved(m); onClose(); }} onReload={() => mutate()} />
        </div>
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <Snapshot d={d} />
          <History d={d} isOwner={isOwner} onChanged={() => mutate()} />
        </div>
      </div>
    </div>
  );
}

function NumberPanel({ phone, email }: { phone: string; email: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(phone); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <section style={{ background: "linear-gradient(150deg,#3b2a1e,#5a4231)", color: "#fff", borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: R.gold, fontWeight: 700 }}>Dial on the KoreCall landline</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: ".04em", fontVariantNumeric: "tabular-nums", marginTop: 2 }} aria-label={`Phone ${phone.split("").join(" ")}`}>{groupPhone(phone)}</div>
        {email && <div style={{ fontSize: 12.5, color: "#e9dccb" }}>{email}</div>}
      </div>
      <div style={{ marginLeft: "auto" }}><Btn kind="light" onClick={copy}>{copied ? "Copied ✓" : "Copy number"}</Btn></div>
    </section>
  );
}

function WhatsAppPanel({ d, cfg, readOnly, onSent }: { d: LeadDetail; cfg: CrmConfig; readOnly: boolean; onSent: () => void }) {
  const [tid, setTid] = useState("");
  const [state, setState] = useState<"" | "sending" | string>("");
  const t = cfg.wati_templates.find((x) => x.id === tid);
  const send = async () => {
    if (!t) return;
    setState("sending");
    try {
      const r = await api.post<{ mode: string; template: string }>(`/crm/leads/${d.lead.id}/whatsapp`, { template_id: t.id });
      setState(`Sent "${r.template}"${r.mode === "mock" ? " (mock: nothing left the server)" : ""}`);
      setTid("");
      onSent();
    } catch (e) {
      setState(`! ${(e as Error).message}`);
    }
  };
  return (
    <Panel title="Send WhatsApp template" sub={cfg.wati_mode === "mock" ? "WATI mock mode: credentials pending, sends are only logged" : "WATI live"}>
      <div style={{ display: "grid", gap: 8 }}>
        <select value={tid} onChange={(e) => { setTid(e.target.value); setState(""); }} disabled={readOnly} style={inputStyle} aria-label="WhatsApp template">
          <option value="">Choose a template…</option>
          {cfg.wati_templates.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        {t && <div style={{ background: "#eef6ea", border: "1px solid #d5e6cd", borderRadius: 10, padding: "9px 12px", fontSize: 13, whiteSpace: "pre-wrap" }}>{fillVars(t.body, d.wa_vars)}</div>}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Btn kind="good" onClick={send} disabled={!t || readOnly || state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</Btn>
          {state && state !== "sending" && <span role="status" style={{ fontSize: 12.5, color: state.startsWith("!") ? R.bad : R.good }}>{state}</span>}
        </div>
      </div>
    </Panel>
  );
}

function OutcomeForm({ d, cfg, readOnly, onSaved, onReload }: { d: LeadDetail; cfg: CrmConfig; readOnly: boolean; onSaved: (m: string) => void; onReload: () => void }) {
  const l = d.lead;
  const [code, setCode] = useState<Code | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(istToday());
  const [time, setTime] = useState("");
  const [studentTime, setStudentTime] = useState(false);
  const [amount, setAmount] = useState("299");
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries((l.answers ?? []).map((a) => [a.question_id, a.value])));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const kind = CODES.find((c) => c.code === code)?.kind;
  const needsCallback = kind === "callback";
  const needsNote = needsCallback || code === "F";
  const reasons = useMemo(() => cfg.reasons.filter((r) => code && r.codes.includes(code)), [cfg.reasons, code]);
  const chips = useMemo(() => cfg.note_templates.filter((t) => code && t.codes.includes(code)), [cfg.note_templates, code]);

  const pickCode = (c: Code) => { setCode(c); setReason(""); setErr(""); };
  const insertChip = useCallback((text: string) => {
    const filled = text.replace(/\{date\}/g, fmtChipDate(date) || "{date}").replace(/\{time\}/g, fmtChipTime(time) || "{time}");
    setNote((n) => (n.trim() ? `${n.trim()} ${filled}` : filled));
  }, [date, time]);

  const save = async () => {
    if (!code) return setErr("Pick an outcome code");
    setSaving(true);
    setErr("");
    try {
      const r = await api.post<{ status: string }>(`/crm/leads/${l.id}/outcome`, {
        version: l.version, code,
        reason: reason || null, note: note.trim() || null,
        answers: cfg.questions.filter((q) => answers[q.id]).map((q) => ({ question_id: q.id, label: q.label, value: answers[q.id] })),
        callback_at: needsCallback && date && time ? `${date}T${time}:00+05:30` : null,
        student_set_time: needsCallback && studentTime,
        amount: code === "F" ? Number(amount) || 299 : null,
      });
      onSaved(`${l.lead_code} saved as ${code} · ${STATUS_LABEL[r.status] ?? r.status}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const stale = /updated by/.test(err);
  return (
    <>
      <Panel title="Questions" sub="Answers stay on the lead for the next rep">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {cfg.questions.map((q) => (
            <label key={q.id} style={{ minWidth: 0 }}>
              <span style={labelStyle}>{q.label}</span>
              {q.type === "text" ? (
                <input value={answers[q.id] ?? ""} disabled={readOnly} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} style={inputStyle} />
              ) : (
                <select value={answers[q.id] ?? ""} disabled={readOnly} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} style={inputStyle}>
                  <option value="">—</option>
                  {(q.type === "yesno" ? ["Yes", "No"] : q.options).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="Outcome" sub="What happened on this call">
        <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 12, minWidth: 0 }}>
          <div role="radiogroup" aria-label="Outcome code" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
            {CODES.map((c) => {
              const on = code === c.code;
              const accent = { retry: "#b9a68e", callback: R.gold, paid: R.good, closed: R.bad }[c.kind];
              return (
                <button key={c.code} role="radio" aria-checked={on} onClick={() => pickCode(c.code)} className="crm-btn"
                  style={{ textAlign: "left", display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                    background: on ? "#fff7e8" : R.card, border: `1.5px solid ${on ? accent : R.line}`, boxShadow: on ? `0 0 0 3px ${accent}33` : "none", color: R.ink }}>
                  <CodeChip code={c.code} big />
                  <span style={{ minWidth: 0 }}><b style={{ display: "block", fontSize: 13 }}>{c.label}</b><span style={{ fontSize: 11.5, color: R.mute }}>{c.rule}</span></span>
                </button>
              );
            })}
          </div>
          {code && (
            <>
              <label>
                <span style={labelStyle}>Reason{needsNote ? " *" : ""}</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle}>
                  <option value="">{reasons.length ? "Choose a reason…" : "No reasons for this code"}</option>
                  {reasons.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
                </select>
              </label>
              {needsCallback && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label><span style={labelStyle}>Callback date *</span>
                    <input type="date" value={date} min={istToday()} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></label>
                  <label><span style={labelStyle}>Callback time (IST) *</span>
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} /></label>
                  <label style={{ gridColumn: "span 2", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" checked={studentTime} onChange={(e) => setStudentTime(e.target.checked)} /> Student asked for this time
                  </label>
                </div>
              )}
              {chips.length > 0 && (
                <div>
                  <span style={labelStyle}>Quick notes</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {chips.map((t) => (
                      <button key={t.id} type="button" onClick={() => insertChip(t.text)} className="crm-btn" title={t.text}
                        style={{ border: `1px solid ${R.line}`, background: R.soft, borderRadius: 999, padding: "5px 11px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", color: R.ink }}>
                        + {t.label}</button>
                    ))}
                  </div>
                </div>
              )}
              <label>
                <span style={labelStyle}>Note{needsNote ? ` * (at least ${MIN_NOTE} characters)` : ""}</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
                {needsNote && <span style={{ fontSize: 11.5, color: note.trim().length >= MIN_NOTE ? R.good : R.mute }}>{note.trim().length}/{MIN_NOTE}</span>}
              </label>
              {code === "F" && (
                <label style={{ maxWidth: 200 }}><span style={labelStyle}>Amount (₹)</span>
                  <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} /></label>
              )}
            </>
          )}
          {err && (
            <div role="alert" style={{ color: R.bad, fontSize: 13, fontWeight: 600, display: "flex", gap: 10, alignItems: "center" }}>
              {err}{stale && <Btn kind="ghost" onClick={() => { setErr(""); onReload(); }}>Reload</Btn>}
            </div>
          )}
          <div><Btn onClick={save} disabled={!code || saving || readOnly} style={{ padding: "11px 22px" }}>{saving ? "Saving…" : "Save"}</Btn></div>
        </fieldset>
      </Panel>
    </>
  );
}
