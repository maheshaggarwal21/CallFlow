"use client";

// The lead sheet ("Lead follow-up"): everything about one lead on one screen.
// Left: answers, outcome code, reason, callback, notes (Save always in reach), WhatsApp template.
// Right: snapshot, what happens next, and the call log across every rep.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { Avatar, R } from "@/components/report/kit";
import { API_BASE, api, fetcher } from "@/lib/api";
import { CODES, MIN_NOTE, STATUS_LABEL, fillVars, groupPhone, type Code, type CrmConfig, type FollowUpDraft, type LeadDetail } from "@/lib/crm";
import { useAuth } from "@/hooks/useAuth";
import { useCrmMe } from "@/hooks/useCrmMe";
import { Btn, CodeChip, Drawer, inputStyle, labelStyle } from "./kit";
import { Card, FollowUpBanner, History, Snapshot } from "./History";
import { Icon } from "./icons";

const HEARTBEAT_MS = 60_000;
const IDLE_MS = 2 * 60_000;
const NOTE_MAX = 2000;
const IST = "Asia/Kolkata";

type Lock = { mine: boolean; locked_by_name: string | null } | null;

const SHEET_CSS = `
  .lf-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(360px,1fr);gap:14px;align-items:start}
  .lf-q{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  .lf-codes{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
  .lf-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .lf-wa{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:14px}
  .lf-code{transition:background .15s,border-color .15s,box-shadow .15s,transform .15s}
  .lf-code:hover{transform:translateY(-1px)}
  @media (max-width:1180px){.lf-grid{grid-template-columns:1fr}.lf-codes{grid-template-columns:repeat(4,minmax(0,1fr))}}
  @media (max-width:820px){.lf-q,.lf-3,.lf-wa{grid-template-columns:1fr 1fr}}
  @media (prefers-reduced-motion: reduce){.lf-code{transition:none}.lf-code:hover{transform:none}}
`;

const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: IST });
const fmtChipDate = (d: string) => (d ? new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: IST }) : "");
const fmtChipTime = (t: string) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const received = (d: string) => new Date(d).toLocaleString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
const KIND = {
  retry: { tint: "#f4ece0", ring: "#b9a68e" },
  callback: { tint: "#fdf1da", ring: R.gold },
  paid: { tint: "#e8f2e3", ring: R.good },
  closed: { tint: "#fbe7e3", ring: R.bad },
} as const;

export default function LeadDrawer({ leadId, onClose, onSaved, isOwner }: { leadId: string | null; onClose: () => void; onSaved: (msg: string) => void; isOwner: boolean }) {
  return (
    <Drawer open={!!leadId} onClose={onClose} label="Lead" width={1400}>
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
  const waRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<FollowUpDraft>(null);

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
    <div style={{ display: "grid", gap: 12, color: R.ink }}>
      <style>{SHEET_CSS}</style>
      <SheetHeader d={d} watiMode={cfg.wati_mode} onClose={onClose} onWhatsApp={() => waRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
        revive={l.status === "dropped" && can("reassign_leads") ? () => api.post(`/crm/leads/${l.id}/revive`).then(() => { setReviveErr(""); mutate(); }, (e) => setReviveErr((e as Error).message)) : undefined} />
      {reviveErr && <p role="alert" style={{ margin: 0, color: R.bad, fontSize: 13 }}>{reviveErr}</p>}
      {readOnly && (
        <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", background: "#fff1d6", border: `1px solid ${R.gold}`, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="lock" size={18} style={{ color: "#8a5a12" }} />
          {lock?.locked_by_name} is on this lead. You can read it, but the form is read-only until they save or close.
        </div>
      )}
      <div className="lf-grid">
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <OutcomeForm d={d} cfg={cfg} readOnly={readOnly} onDraft={setDraft} onSaved={(m) => { mutate(); onSaved(m); onClose(); }} onReload={() => mutate()} />
          <div ref={waRef}><WhatsAppPanel d={d} cfg={cfg} readOnly={readOnly} onSent={() => mutate()} /></div>
        </div>
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <Snapshot d={d} />
          <History d={d} isOwner={isOwner} onChanged={() => mutate()} />
          <FollowUpBanner d={d} draft={draft} />
        </div>
      </div>
    </div>
  );
}

function WatiPill({ mode }: { mode: "mock" | "live" }) {
  const live = mode === "live";
  return (
    <span title={live ? "WATI credentials set: template sends go out on WhatsApp" : "WATI credentials pending: sends are only logged"}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 999,
        background: live ? "#e3f4dd" : "#fff1d6", color: live ? "#2f6b2b" : "#8a5a12", border: `1px solid ${live ? "#a9d39b" : R.gold}` }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: live ? "#3fae3a" : "#d39b2a", boxShadow: live ? "0 0 8px #3fae3a" : "none" }} />
      {live ? "WATI connected" : "WATI mock mode"}
    </span>
  );
}

function SheetHeader({ d, watiMode, onClose, onWhatsApp, revive }: { d: LeadDetail; watiMode: "mock" | "live"; onClose: () => void; onWhatsApp: () => void; revive?: () => void }) {
  const l = d.lead;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(l.phone10); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const meta = (icon: Parameters<typeof Icon>[0]["name"], k: string, v: ReactNode) => (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "#e9dccb" }}>
      <Icon name={icon} size={15} style={{ color: R.gold }} />{k} <b style={{ color: "#fff", fontWeight: 600 }}>{v}</b>
    </span>
  );
  const light = { background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.22)", color: "#fff" };
  return (
    <header style={{ background: "linear-gradient(160deg,#3b2a1e,#5a4231 70%,#6f4f35)", color: "#fff", borderRadius: 16, padding: "14px 16px", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, flex: "1 1 420px" }}>
        <Avatar name={l.name || "?"} size={50} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: R.gold, fontWeight: 700 }}>Lead follow-up</div>
          <h2 style={{ margin: "1px 0 6px", fontSize: 23, fontWeight: 800, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {l.name || "Unnamed lead"} <CodeChip code={l.current_code} big />
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "rgba(255,255,255,.14)" }}>{STATUS_LABEL[l.status] ?? l.status}</span>
            {l.tags?.includes("re-enquired") && <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: R.gold, color: "#3b2a1e" }}>re-enquired</span>}
          </h2>
          <div style={{ display: "flex", gap: "4px 16px", flexWrap: "wrap" }}>
            {meta("user", "Lead ID", l.lead_code)}
            {meta("calendar", "Received", received(l.created_at))}
            {meta("megaphone", "Source", [l.source === "demo" ? null : l.source, l.campaign].filter(Boolean).join(" · ") || "—")}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", background: "rgba(0,0,0,.18)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 14, padding: "10px 14px" }}>
        <div>
          <div style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: R.gold, fontWeight: 700 }}>Dial on KoreCall</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: ".04em", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }} aria-label={`Phone ${l.phone10.split("").join(" ")}`}>{groupPhone(l.phone10)}</div>
          {l.email && <div style={{ fontSize: 11.5, color: "#e9dccb" }}>{l.email}</div>}
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <Btn kind="light" onClick={copy} style={{ ...light, padding: "7px 12px" }}><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name={copied ? "check" : "copy"} size={15} />{copied ? "Copied" : "Copy"}</span></Btn>
          <Btn kind="good" onClick={onWhatsApp} style={{ padding: "7px 12px" }}><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="chat" size={15} />WhatsApp</span></Btn>
        </div>
      </div>
      <div style={{ display: "grid", gap: 6, alignSelf: "flex-start", justifyItems: "end" }}>
        <Btn kind="light" onClick={onClose} style={light}>Close ✕</Btn>
        <WatiPill mode={watiMode} />
        {revive && <Btn kind="light" onClick={revive} style={light} title="Back into the queue as a retry, attempts reset">↺ Revive</Btn>}
      </div>
    </header>
  );
}

function SectionLabel({ icon, children, right }: { icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "2px 0 8px" }}>
      <Icon name={icon} size={15} style={{ color: R.out }} />
      <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: R.ink }}>{children}</span>
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}

// Quick fills for the callback picker, in IST
function preset(kind: "1h" | "today6" | "tom10" | "tom6"): { date: string; time: string } {
  const ist = (ms: number) => new Date(ms).toLocaleString("sv-SE", { timeZone: IST }); // "YYYY-MM-DD HH:MM:SS"
  const now = Date.now();
  if (kind === "1h") { const [dd, tt] = ist(now + 3_600_000).split(" "); return { date: dd, time: tt.slice(0, 5) }; }
  const day = ist(kind === "today6" ? now : now + 86_400_000).split(" ")[0];
  return { date: day, time: kind === "tom10" ? "10:00" : "18:00" };
}

/** The automatic retry time for A/B/C, using the same rules as the server. */
function autoRetry(code: Code, reason: string, attempts: number, rules: CrmConfig["retry_rules"]): { at: string | null; text: string } {
  const max = rules.max_attempts ?? 6;
  if (reason === "Invalid number" && rules.invalid?.never !== false) return { at: null, text: "Invalid number: the lead will be Dropped, no retry." };
  if (attempts + 1 >= max) return { at: null, text: `This is failed attempt ${attempts + 1} of ${max}: the lead will be Dropped.` };
  const rule = rules[code as "A" | "B" | "C"] ?? { hours: 3 };
  let at: Date;
  if (rule.next_day_at) {
    const day = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: IST });
    at = new Date(`${day}T${rule.next_day_at}:00+05:30`);
  } else {
    at = new Date(Date.now() + (rule.hours ?? 3) * 3_600_000);
  }
  return { at: at.toISOString(), text: `Automatic: back in the Retry list ${rule.next_day_at ? `tomorrow at ${fmtChipTime(rule.next_day_at)}` : `after ${rule.hours ?? 3} h`} (retry rule for ${code}).` };
}

function OutcomeForm({ d, cfg, readOnly, onDraft, onSaved, onReload }: { d: LeadDetail; cfg: CrmConfig; readOnly: boolean; onDraft: (d: FollowUpDraft) => void; onSaved: (m: string) => void; onReload: () => void }) {
  const l = d.lead;
  const { id: meId } = useAuth();
  // The rep who last worked this lead, from the history
  const lastRep = useMemo(() => {
    for (const e of d.timeline) if (e.type === "interaction" && e.kind === "call_outcome" && e.employee_id) return { id: e.employee_id, name: e.employee_name };
    return null;
  }, [d.timeline]);
  const [repId, setRepId] = useState<string>(l.assigned_to ?? lastRep?.id ?? "");
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

  const meta = CODES.find((c) => c.code === code);
  const needsCallback = meta?.kind === "callback";
  const needsNote = needsCallback || code === "F";
  const reasons = useMemo(() => cfg.reasons.filter((r) => code && r.codes.includes(code)), [cfg.reasons, code]);
  const chips = useMemo(() => cfg.note_templates.filter((t) => code && t.codes.includes(code)), [cfg.note_templates, code]);

  const pickCode = (c: Code) => { setCode(c); setReason(""); setErr(""); };
  const effectiveRep = repId || meId;
  const repName = cfg.reps.find((r) => r.id === effectiveRep)?.name ?? null;
  const auto = code && meta?.kind === "retry" ? autoRetry(code, reason, l.attempts, cfg.retry_rules) : null;

  // Live preview of the follow-up for the siren banner under the call log
  useEffect(() => {
    if (!code) return onDraft(null);
    if (needsCallback) return onDraft({ kind: "callback", at: date && time ? new Date(`${date}T${time}:00+05:30`).toISOString() : null, repName, text: "" });
    if (auto) return onDraft({ kind: "auto", at: auto.at, repName: null, text: auto.text });
    onDraft({ kind: "none", at: null, repName: null, text: code === "F" ? "Paid: no follow-up call needed." : "Never call again: no follow-up." });
  }, [code, needsCallback, date, time, repName, auto?.at, auto?.text, onDraft]);
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
        assigned_to: needsCallback ? effectiveRep || null : null,
      });
      onSaved(`${l.lead_code} saved as ${code} · ${STATUS_LABEL[r.status] ?? r.status}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const stale = /updated by/.test(err);
  const noteLen = note.trim().length;
  return (
    <Card icon="phone" title="Call & follow-up" right={<span style={{ fontSize: 12, color: R.mute }}>Dial on the landline, then fill this in</span>}>
      <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 14, minWidth: 0 }}>
        <div>
          <SectionLabel icon="user">Student answers</SectionLabel>
          <div className="lf-q">
            {cfg.questions.map((q) => (
              <label key={q.id} style={{ minWidth: 0 }}>
                <span style={{ ...labelStyle, fontSize: 10.5 }}>{q.label}</span>
                {q.type === "text" ? (
                  <input value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} style={inputStyle} />
                ) : (
                  <select value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} style={inputStyle}>
                    <option value="">—</option>
                    {(q.type === "yesno" ? ["Yes", "No"] : q.options).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
              </label>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel icon="target" right={meta && <span style={{ fontSize: 12, color: R.mute }}>{meta.rule}</span>}>Outcome *</SectionLabel>
          <div role="radiogroup" aria-label="Outcome code" className="lf-codes">
            {CODES.map((c) => {
              const on = code === c.code, k = KIND[c.kind];
              return (
                <button key={c.code} role="radio" aria-checked={on} aria-label={`${c.code}: ${c.label}`} onClick={() => pickCode(c.code)} className="lf-code" title={c.rule}
                  style={{ display: "grid", justifyItems: "center", gap: 5, padding: "9px 4px 8px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", color: R.ink,
                    background: on ? k.tint : R.card, border: `1.5px solid ${on ? k.ring : R.line}`, boxShadow: on ? `0 0 0 3px ${k.ring}30` : "none" }}>
                  <CodeChip code={c.code} big />
                  <span style={{ fontSize: 11.5, fontWeight: on ? 800 : 600, lineHeight: 1.2, textAlign: "center" }}>{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {code && (
          <div style={{ display: "grid", gap: 10 }}>
            <div className={code === "F" ? "lf-3" : undefined}>
              <label style={{ gridColumn: code === "F" ? "span 2" : undefined, display: "block" }}>
                <span style={labelStyle}>Reason{needsNote ? " *" : ""}</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle}>
                  <option value="">{reasons.length ? "Choose a reason…" : "No reasons for this code"}</option>
                  {reasons.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
                </select>
              </label>
              {code === "F" && (
                <label><span style={labelStyle}>Amount (₹)</span>
                  <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} /></label>
              )}
            </div>

            <div style={{ background: needsCallback ? "#fff8ee" : R.soft, border: `1px solid ${needsCallback ? "#efd9b8" : R.line}`, borderRadius: 12, padding: "10px 12px" }}>
              <SectionLabel icon="calendar">Next follow-up{needsCallback ? " *" : ""}</SectionLabel>
              {needsCallback ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {([["1h", "In 1 hour"], ["today6", "Today 6 PM"], ["tom10", "Tomorrow 10 AM"], ["tom6", "Tomorrow 6 PM"]] as const).map(([k, label]) => (
                      <button key={k} type="button" className="crm-btn" onClick={() => { const p = preset(k); setDate(p.date); setTime(p.time); }}
                        style={{ border: `1px solid ${R.gold}`, background: "#fff", borderRadius: 999, padding: "4px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: "#8a5a12" }}>
                        {label}</button>
                    ))}
                  </div>
                  <div className="lf-3">
                    <label><span style={labelStyle}>Callback date *</span>
                      <input type="date" value={date} min={istToday()} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></label>
                    <label><span style={labelStyle}>Callback time (IST) *</span>
                      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} /></label>
                    <label><span style={labelStyle}>Representative (assigned to)</span>
                      <select value={repId} onChange={(e) => setRepId(e.target.value)} style={inputStyle} aria-label="Representative">
                        <option value="">Me (whoever saves)</option>
                        {cfg.reps.map((r) => <option key={r.id} value={r.id}>{r.name}{r.id === lastRep?.id ? " · handled before" : ""}</option>)}
                      </select>
                    </label>
                  </div>
                  {lastRep?.name && <div style={{ fontSize: 12, color: R.mute, marginTop: -4 }}>{lastRep.name} worked this lead last. Change it if someone else should call back.</div>}
                  <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontWeight: 600, background: studentTime ? "#fdf1da" : "#fff",
                    border: `1px dashed ${studentTime ? R.gold : R.line}`, borderRadius: 10, padding: "8px 12px", cursor: "pointer", transition: "background .15s" }}>
                    <input type="checkbox" checked={studentTime} onChange={(e) => setStudentTime(e.target.checked)} style={{ width: 17, height: 17, accentColor: R.out }} />
                    Student asked for this time
                    <span style={{ fontWeight: 400, color: R.mute }}>· shown to every rep on the callback</span>
                  </label>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: R.ink }}>
                  {auto ? <>{auto.text}{auto.at && <b> {new Date(auto.at).toLocaleString("en-GB", { timeZone: IST, day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</b>}</>
                    : code === "F" ? "Paid: no follow-up call needed." : "Never call again: no follow-up."}
                  <div style={{ fontSize: 11.5, color: R.mute, marginTop: 3 }}>Only D and E set a callback by hand; retry waits come from CRM Settings → Retry rules.</div>
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <SectionLabel icon="note" right={<span style={{ fontSize: 11.5, color: needsNote ? (noteLen >= MIN_NOTE ? R.good : R.mute) : R.mute, fontVariantNumeric: "tabular-nums" }}>
            {needsNote ? `min ${MIN_NOTE} · ` : ""}{noteLen} / {NOTE_MAX}</span>}>
            Notes / conversation summary{needsNote ? " *" : ""}
          </SectionLabel>
          {chips.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {chips.map((t) => (
                <button key={t.id} type="button" onClick={() => insertChip(t.text)} className="crm-btn" title={t.text}
                  style={{ border: `1px solid ${R.line}`, background: R.soft, borderRadius: 999, padding: "5px 11px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", color: R.ink }}>
                  + {t.label}</button>
              ))}
            </div>
          )}
          <textarea aria-label="Note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder={code ? "What did the student say?" : "Pick an outcome code first"} style={{ ...inputStyle, resize: "vertical" }} />
        </div>

        {/* Save stays in reach while scrolling the drawer */}
        <div style={{ position: "sticky", bottom: -12, margin: "0 -14px -12px", padding: "10px 14px 12px", background: "linear-gradient(180deg,rgba(255,253,248,0),#fffdf8 30%)", display: "grid", gap: 8 }}>
          {err && (
            <div role="alert" style={{ color: R.bad, fontSize: 13, fontWeight: 600, display: "flex", gap: 10, alignItems: "center" }}>
              {err}{stale && <Btn kind="ghost" onClick={() => { setErr(""); onReload(); }}>Reload</Btn>}
            </div>
          )}
          <Btn onClick={save} disabled={!code || saving || readOnly}
            style={{ padding: "13px 22px", fontSize: 15, background: `linear-gradient(135deg,${R.out},#c4622d)`, boxShadow: "0 10px 22px -12px rgba(196,98,45,.9)", width: "100%" }}>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Icon name="save" size={18} />{saving ? "Saving…" : "Save form"}</span>
          </Btn>
        </div>
      </fieldset>
    </Card>
  );
}

function WhatsAppPanel({ d, cfg, readOnly, onSent }: { d: LeadDetail; cfg: CrmConfig; readOnly: boolean; onSent: () => void }) {
  const [tid, setTid] = useState("");
  const [state, setState] = useState<"" | "sending" | string>("");
  const [preview, setPreview] = useState(true);
  const t = cfg.wati_templates.find((x) => x.id === tid);
  const vars = t ? [...new Set([...t.body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))] : [];
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
  const now = new Date().toLocaleTimeString("en-US", { timeZone: IST, hour: "numeric", minute: "2-digit" });
  return (
    <Card icon="chat" title="Send WhatsApp template" tone="#eef6ea"
      right={<span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
        <label style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          Preview
          <button type="button" role="switch" aria-checked={preview} aria-label="Show template preview" onClick={() => setPreview((p) => !p)}
            style={{ width: 38, height: 22, borderRadius: 11, border: 0, padding: 2, cursor: "pointer", background: preview ? R.good : "#cdbba1", transition: "background .15s" }}>
            <span style={{ display: "block", width: 18, height: 18, borderRadius: 9, background: "#fff", transform: `translateX(${preview ? 16 : 0}px)`, transition: "transform .15s", boxShadow: "0 1px 2px rgba(0,0,0,.3)" }} />
          </button>
        </label>
        <WatiPill mode={cfg.wati_mode} />
      </span>}>
      <div className="lf-wa" style={preview ? undefined : { gridTemplateColumns: "1fr" }}>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <label><span style={labelStyle}>Template</span>
            <select value={tid} onChange={(e) => { setTid(e.target.value); setState(""); }} disabled={readOnly} style={inputStyle} aria-label="WhatsApp template">
              <option value="">Choose a template…</option>
              {cfg.wati_templates.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          {t && (
            <div style={{ background: R.soft, borderRadius: 10, padding: "8px 10px" }}>
              <span style={{ ...labelStyle, marginBottom: 6 }}>Variables (auto-filled)</span>
              <div style={{ display: "grid", gap: 4 }}>
                {vars.map((v) => (
                  <div key={v} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "baseline" }}>
                    <code style={{ background: "#f8e3df", color: R.bad, borderRadius: 5, padding: "1px 6px", fontSize: 11.5 }}>{`{${v}}`}</code>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.wa_vars[v] || <i style={{ color: R.mute }}>empty</i>}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Btn kind="good" onClick={send} disabled={!t || readOnly || state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</Btn>
            {state && state !== "sending" && <span role="status" style={{ fontSize: 12.5, color: state.startsWith("!") ? R.bad : R.good }}>{state}</span>}
          </div>
        </div>
        {preview && <div aria-label="Template preview" style={{ background: "#e9e1d4", backgroundImage: "radial-gradient(rgba(59,42,30,.07) 1px, transparent 1px)", backgroundSize: "12px 12px",
          borderRadius: 12, padding: 12, minHeight: 150, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: R.mute, letterSpacing: ".06em", textTransform: "uppercase" }}>Preview</span>
          <div style={{ alignSelf: "flex-start", maxWidth: "92%", background: "#fff", borderRadius: "4px 12px 12px 12px", padding: "8px 10px 6px", boxShadow: "0 1px 1px rgba(0,0,0,.08)", fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
            {t ? fillVars(t.body, d.wa_vars) : <span style={{ color: R.mute }}>Pick a template to see exactly what {d.lead.name.split(" ")[0] || "the student"} will receive.</span>}
            <div style={{ textAlign: "right", fontSize: 10.5, color: R.mute, marginTop: 2 }}>Max Music School · {now}</div>
          </div>
        </div>}
      </div>
    </Card>
  );
}
