"use client";

// The lead form ("Lead follow-up"), kept simple on the client's request (7 Nov):
// left: student details and the call & follow-up fields with one Save; right: snapshot and call log.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { R } from "@/components/report/kit";
import { API_BASE, api, fetcher } from "@/lib/api";
import { CODES, MIN_NOTE, groupPhone, statusLabel, type Code, type CrmConfig, type LeadDetail } from "@/lib/crm";
import { useAuth } from "@/hooks/useAuth";
import { WhatsAppIcon } from "@/components/ui/WABtn";
import { Btn, Drawer, inputStyle, labelStyle } from "./kit";
import { Card, History, Snapshot } from "./History";
import { Icon } from "./icons";

const HEARTBEAT_MS = 60_000;
const IDLE_MS = 2 * 60_000;
const NOTE_MAX = 500;
const IST = "Asia/Kolkata";

type Lock = { mine: boolean; locked_by_name: string | null } | null;

const SHEET_CSS = `
  .lf-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(340px,1fr);gap:14px;align-items:start}
  .lf-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  @media (max-width:1100px){.lf-grid{grid-template-columns:1fr}}
  @media (max-width:640px){.lf-2{grid-template-columns:1fr}}
`;

const received = (d: string) => new Date(d).toLocaleString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
/** ISO → IST "YYYY-MM-DD" and "HH:MM" for the date and time inputs. */
const istParts = (iso: string) => { const [d, t] = new Date(iso).toLocaleString("sv-SE", { timeZone: IST }).split(" "); return { date: d, time: t.slice(0, 5) }; };
const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: IST });

export default function LeadDrawer({ leadId, onClose, onSaved, isOwner }: { leadId: string | null; onClose: () => void; onSaved: (msg: string) => void; isOwner: boolean }) {
  return (
    <Drawer open={!!leadId} onClose={onClose} label="Lead" width={1300}>
      {leadId && <DrawerBody key={leadId} leadId={leadId} onClose={onClose} onSaved={onSaved} isOwner={isOwner} />}
    </Drawer>
  );
}

function DrawerBody({ leadId, onClose, onSaved, isOwner }: { leadId: string; onClose: () => void; onSaved: (msg: string) => void; isOwner: boolean }) {
  const { data: d, error, mutate } = useSWR<LeadDetail>(`/crm/leads/${leadId}`, fetcher, { refreshInterval: 30_000 });
  const { data: cfg } = useSWR<CrmConfig>("/crm/config", fetcher);
  const [lock, setLock] = useState<Lock>(null);
  const lastActive = useRef(Date.now());

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

  return (
    <div style={{ display: "grid", gap: 12, color: R.ink }}>
      <style>{SHEET_CSS}</style>
      <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: R.out, fontWeight: 700 }}>Lead follow-up</div>
          <h2 style={{ margin: "1px 0 0", fontSize: 22, fontWeight: 800 }}>{d.lead.name || "Unnamed lead"}</h2>
          <div style={{ display: "flex", gap: "2px 16px", flexWrap: "wrap", fontSize: 12.5, color: R.mute, marginTop: 2 }}>
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Icon name="calendar" size={14} style={{ color: R.out }} />Lead received: <b style={{ color: R.ink }}>{received(d.lead.created_at)}</b></span>
            {d.lead.campaign && <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Icon name="megaphone" size={14} style={{ color: R.out }} />Lead source: <b style={{ color: R.ink }}>{d.lead.campaign}</b></span>}
          </div>
        </div>
        <span style={{ marginLeft: "auto" }}><Btn kind="ghost" onClick={onClose}>Close ✕</Btn></span>
      </header>
      {readOnly && (
        <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", background: "#fff1d6", border: `1px solid ${R.gold}`, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="lock" size={18} style={{ color: "#8a5a12" }} />
          {lock?.locked_by_name} is on this lead. You can read it, but the form is read-only until they save or close.
        </div>
      )}
      <div className="lf-grid">
        <LeadForm d={d} cfg={cfg} readOnly={readOnly} onSaved={(m) => { mutate(); onSaved(m); onClose(); }} onReload={() => mutate()} />
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <Snapshot d={d} />
          <History d={d} isOwner={isOwner} onChanged={() => mutate()} />
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ icon, children }: { icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "2px 0 10px" }}>
      <Icon name={icon} size={16} style={{ color: R.out }} />
      <span style={{ fontSize: 14, fontWeight: 800, color: R.ink }}>{children}</span>
    </div>
  );
}

/** The automatic follow-up for "no contact" outcomes, using the same retry rules as the server. */
function autoRetry(code: Code, attempts: number, rules: CrmConfig["retry_rules"]): string | null {
  if (attempts + 1 >= (rules.max_attempts ?? 6)) return null; // this try drops the lead
  const rule = rules[code as "A" | "B" | "C"] ?? { hours: 3 };
  if (rule.next_day_at) {
    const day = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: IST });
    return new Date(`${day}T${rule.next_day_at}:00+05:30`).toISOString();
  }
  return new Date(Date.now() + (rule.hours ?? 3) * 3_600_000).toISOString();
}

function LeadForm({ d, cfg, readOnly, onSaved, onReload }: { d: LeadDetail; cfg: CrmConfig; readOnly: boolean; onSaved: (m: string) => void; onReload: () => void }) {
  const l = d.lead;
  const { id: meId } = useAuth();
  // Representative: whoever the lead is assigned to, else the rep who last worked it, else me
  const lastRep = useMemo(() => {
    for (const e of d.timeline) if (e.type === "interaction" && e.kind === "call_outcome" && e.employee_id) return e.employee_id;
    return null;
  }, [d.timeline]);
  const [repId, setRepId] = useState<string>(l.assigned_to ?? lastRep ?? meId ?? "");
  const [guitar, setGuitar] = useState(l.has_guitar == null ? "" : l.has_guitar ? "Yes" : "No");
  const [code, setCode] = useState<Code | "">("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [amount, setAmount] = useState(l.amount ? String(Number(l.amount)) : "299");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const kind = CODES.find((c) => c.code === code)?.kind;
  const followUp = kind === "retry" || kind === "callback";
  const talked = kind === "callback" || kind === "paid" || kind === "closed";
  const needsNote = kind === "callback" || kind === "paid";
  const drops = kind === "retry" && !autoRetry(code as Code, l.attempts, cfg.retry_rules);

  const pickStatus = (c: Code | "") => {
    setCode(c);
    setErr("");
    // "No contact" outcomes pre-fill the automatic retry time; the rep can change it
    const k = CODES.find((x) => x.code === c)?.kind;
    const auto = k === "retry" ? autoRetry(c as Code, l.attempts, cfg.retry_rules) : null;
    if (auto) { const p = istParts(auto); setDate(p.date); setTime(p.time); }
    else if (k !== "callback") { setDate(""); setTime(""); }
  };

  const save = async () => {
    if (!code) return setErr("Choose a status");
    if (talked && !guitar) return setErr("Choose Guitar: Yes or No");
    if (kind === "callback" && (!date || !time)) return setErr("Set the next follow-up date and time");
    if (needsNote && note.trim().length < MIN_NOTE) return setErr(`Write a note of at least ${MIN_NOTE} characters`);
    if (!repId) return setErr("Choose the representative");
    setSaving(true);
    setErr("");
    try {
      await api.post(`/crm/leads/${l.id}/outcome`, {
        version: l.version, code,
        note: note.trim() || null,
        callback_at: followUp && !drops && date && time ? `${date}T${time}:00+05:30` : null,
        amount: Number(amount) || null,
        assigned_to: repId,
        has_guitar: guitar ? guitar === "Yes" : null,
      });
      onSaved(`${l.name || "Lead"} saved as ${statusLabel({ status: "x", current_code: code })}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const stale = /updated by/.test(err);
  const star = (on: boolean) => (on ? <span style={{ color: R.bad }}> *</span> : null);
  const lbl = (text: string, required: boolean) => <span style={labelStyle}>{text}{star(required)}</span>;
  const box = { ...inputStyle, background: "#f7f2ea", display: "flex", gap: 8, alignItems: "center" } as const;
  return (
    <Card icon="user" title="Student & lead details">
      <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 16, minWidth: 0 }}>
        <div className="lf-2" style={{ alignItems: "end" }}>
          <div>{lbl("Name", false)}<div style={box}><Icon name="user" size={15} style={{ color: R.mute }} />{l.name || "—"}</div></div>
          <div>
            {lbl("Contact", false)}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ ...box, flex: 1, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}><Icon name="phone" size={15} style={{ color: R.mute }} />{groupPhone(l.phone10)}</div>
              <a href={`https://wa.me/91${l.phone10}`} target="_blank" rel="noopener noreferrer" className="crm-btn" title="Chat on WhatsApp"
                style={{ display: "inline-flex", gap: 6, alignItems: "center", background: "#25D366", color: "#fff", borderRadius: 10, padding: "0 14px", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>
                <WhatsAppIcon size={16} />WhatsApp</a>
            </div>
          </div>
        </div>

        <div>
          <SectionLabel icon="phone">Call & follow-up information</SectionLabel>
          <div style={{ display: "grid", gap: 12 }}>
            <div className="lf-2">
              <label>{lbl("Guitar", talked)}
                <select value={guitar} onChange={(e) => setGuitar(e.target.value)} style={inputStyle} aria-label="Guitar">
                  <option value="">—</option><option>Yes</option><option>No</option>
                </select></label>
              <label>{lbl("Status", true)}
                <select value={code} onChange={(e) => pickStatus(e.target.value as Code | "")} style={inputStyle} aria-label="Status">
                  <option value="">Choose a status…</option>
                  {CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select></label>
            </div>
            {followUp && !drops && (
              <div className="lf-2">
                <label>{lbl("Next follow-up date", kind === "callback")}
                  <input type="date" value={date} min={istToday()} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></label>
                <label>{lbl("Next follow-up time", kind === "callback")}
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} /></label>
              </div>
            )}
            {kind === "retry" && (
              <div style={{ fontSize: 12.5, color: R.mute, marginTop: -4 }}>
                {drops ? `This is failed attempt ${l.attempts + 1} of ${cfg.retry_rules.max_attempts ?? 6}: the lead will be dropped, no more follow-ups.`
                  : "Filled automatically from the follow-up rules in CRM Settings. Change it if needed."}
              </div>
            )}
            {(kind === "paid" || kind === "closed") && <div style={{ fontSize: 12.5, color: R.mute, marginTop: -4 }}>No follow-up needed for this status.</div>}
            <div className="lf-2">
              <label>{lbl("Representative (assigned to)", true)}
                <select value={repId} onChange={(e) => setRepId(e.target.value)} style={inputStyle} aria-label="Representative">
                  <option value="">Choose…</option>
                  {cfg.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select></label>
              <label>{lbl("Amount (₹)", false)}
                <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} /></label>
            </div>
            <label>
              <span style={{ ...labelStyle, display: "flex" }}>Notes / conversation summary{star(needsNote)}
                <span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{note.length} / {NOTE_MAX}</span></span>
              <textarea value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What did the student say?" style={{ ...inputStyle, resize: "vertical" }} />
            </label>
          </div>
        </div>

        {err && (
          <div role="alert" style={{ color: R.bad, fontSize: 13, fontWeight: 600, display: "flex", gap: 10, alignItems: "center" }}>
            {err}{stale && <Btn kind="ghost" onClick={() => { setErr(""); onReload(); }}>Reload</Btn>}
          </div>
        )}
        <Btn onClick={save} disabled={saving || readOnly}
          style={{ padding: "13px 22px", fontSize: 15, background: `linear-gradient(135deg,${R.out},#c4622d)`, boxShadow: "0 10px 22px -12px rgba(196,98,45,.9)", width: "100%" }}>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Icon name="save" size={18} />{saving ? "Saving…" : "Save"}</span>
        </Btn>
      </fieldset>
    </Card>
  );
}
