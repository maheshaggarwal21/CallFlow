"use client";

// The lead form ("Lead follow-up") as a compact pop-up, kept simple on the client's request:
// the form alone by default; the side handle opens the follow-up snapshot and call log beside it.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import useSWR from "swr";
import { R } from "@/components/report/kit";
import { API_BASE, api, fetcher } from "@/lib/api";
import { MIN_NOTE, groupPhone, type Code, type CodeMeta, type CrmConfig, type LeadDetail } from "@/lib/crm";
import { useCrmCodes } from "@/hooks/useCrmCodes";
import { useAuth } from "@/hooks/useAuth";
import { WhatsAppIcon } from "@/components/ui/WABtn";
import { Btn, CodeChip, Modal, inputStyle, labelStyle } from "./kit";
import { Card, History, Snapshot } from "./History";
import { Icon } from "./icons";

const HEARTBEAT_MS = 60_000;
const IDLE_MS = 2 * 60_000;
const NOTE_MAX = 500;
const IST = "Asia/Kolkata";

type Lock = { mine: boolean; locked_by_name: string | null } | null;

const SHEET_CSS = `
  .lf-grid{display:grid;grid-template-columns:minmax(0,1fr) 30px;gap:10px;align-items:stretch}
  .lf-grid.open{grid-template-columns:minmax(0,1fr) 30px minmax(340px,.9fr)}
  .lf-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .lf-handle{transition:background .15s,color .15s}
  .lf-handle:hover{background:#f8ead2;color:#8a5a12}
  .lf-opt{transition:background .12s}
  .lf-opt:hover,.lf-opt:focus-visible{background:var(--tint);outline:none}
  .lf-siren-dome{animation:lf-siren .9s ease-in-out infinite alternate}
  .lf-siren-rays{transform-origin:32px 30px;animation:lf-spin 2.4s linear infinite}
  @keyframes lf-siren{from{fill:#e8641b;filter:drop-shadow(0 0 2px #e8641b)}to{fill:#ff3b1f;filter:drop-shadow(0 0 10px #ff6a3d)}}
  @keyframes lf-spin{to{transform:rotate(360deg)}}
  .lf-banner{animation:lf-ring 2s ease-out infinite}
  @keyframes lf-ring{0%{box-shadow:0 0 0 0 rgba(232,100,27,.45)}70%{box-shadow:0 0 0 10px rgba(232,100,27,0)}100%{box-shadow:0 0 0 0 rgba(232,100,27,0)}}
  @media (max-width:900px){.lf-grid.open{grid-template-columns:minmax(0,1fr) 30px}.lf-grid.open>.lf-side{grid-column:1/-1}}
  @media (max-width:640px){.lf-2{grid-template-columns:1fr}}
  @media (prefers-reduced-motion: reduce){.lf-siren-dome,.lf-siren-rays,.lf-banner{animation:none}}
`;

/** Status colours, the same families as the code chips: retry beige, callback gold, paid green, closed red. */
const KIND = {
  retry: { tint: "#f4ece0", ring: "#b9a68e", text: "#7a6650" },
  callback: { tint: "#fdf1da", ring: R.gold, text: "#8a5a12" },
  paid: { tint: "#e8f2e3", ring: R.good, text: R.good },
  closed: { tint: "#fbe7e3", ring: R.bad, text: R.bad },
  unused: { tint: "#f1ede6", ring: "#c9bfb1", text: "#8f8577" },
} as const;

const received = (d: string) => new Date(d).toLocaleString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
const longDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
const timeOf = (d: string) => new Date(d).toLocaleTimeString("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });
/** ISO → IST "YYYY-MM-DD" and "HH:MM" for the date and time inputs. */
const istParts = (iso: string) => { const [d, t] = new Date(iso).toLocaleString("sv-SE", { timeZone: IST }).split(" "); return { date: d, time: t.slice(0, 5) }; };
const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: IST });

export default function LeadDrawer({ leadId, onClose, onSaved, isOwner }: { leadId: string | null; onClose: () => void; onSaved: (msg: string) => void; isOwner: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Modal open={!!leadId} onClose={onClose} label="Lead" width={expanded ? 1340 : 820}>
      {leadId && <DrawerBody key={leadId} leadId={leadId} onClose={onClose} onSaved={onSaved} isOwner={isOwner} expanded={expanded} onExpand={setExpanded} />}
    </Modal>
  );
}

function DrawerBody({ leadId, onClose, onSaved, isOwner, expanded, onExpand }: {
  leadId: string; onClose: () => void; onSaved: (msg: string) => void; isOwner: boolean; expanded: boolean; onExpand: (v: boolean) => void;
}) {
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
  const calls = d.timeline.filter((e) => (e.type === "call" ? true : !!e.call)).length;

  return (
    <div style={{ display: "grid", gap: 12, color: R.ink }}>
      <style>{SHEET_CSS}</style>
      <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: R.out, fontWeight: 700 }}>Lead follow-up</div>
          <h2 style={{ margin: "1px 0 0", fontSize: 22, fontWeight: 800 }}>{d.lead.name || "Unnamed lead"}</h2>
          <div style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12.5, color: R.mute, marginTop: 2 }}>
            <Icon name="calendar" size={14} style={{ color: R.out }} /><b style={{ color: R.ink }} title="Lead received">{received(d.lead.created_at)}</b>
          </div>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <NumberBox phone10={d.lead.phone10} />
          <Btn kind="ghost" onClick={onClose}>Close ✕</Btn>
        </span>
      </header>
      {readOnly && (
        <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", background: "#fff1d6", border: `1px solid ${R.gold}`, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="lock" size={18} style={{ color: "#8a5a12" }} />
          {lock?.locked_by_name} is on this lead. You can read it, but the form is read-only until they save or close.
        </div>
      )}
      <div className={`lf-grid${expanded ? " open" : ""}`}>
        <LeadForm d={d} cfg={cfg} readOnly={readOnly} onSaved={(m) => { mutate(); onSaved(m); onClose(); }} onReload={() => mutate()} />
        {/* The handle the client asked for: opens the snapshot and call log beside the form */}
        <button type="button" className="lf-handle" onClick={() => onExpand(!expanded)} aria-expanded={expanded} aria-controls="lf-side"
          title={expanded ? "Hide the follow-up snapshot and call log" : "Show the follow-up snapshot and call log"}
          style={{ border: `1px solid ${R.line}`, background: R.card, borderRadius: 12, cursor: "pointer", color: R.out, fontFamily: "inherit",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "10px 0" }}>
          <span aria-hidden style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{expanded ? "‹" : "›"}</span>
          <span style={{ writingMode: "vertical-rl", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
            {expanded ? "Hide history" : `History · ${calls} call${calls === 1 ? "" : "s"}`}</span>
          <span aria-hidden style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{expanded ? "‹" : "›"}</span>
        </button>
        {expanded && (
          <div id="lf-side" className="lf-side" style={{ display: "grid", gap: 12, minWidth: 0, alignContent: "start" }}>
            <Snapshot d={d} />
            <History d={d} isOwner={isOwner} onChanged={() => mutate()} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The number in big type for dialling on KoreCall, with a copy button. */
function NumberBox({ phone10 }: { phone10: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(phone10); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", background: R.card, border: `1px solid ${R.line}`, borderRadius: 12, padding: "6px 6px 6px 14px" }}>
      <Icon name="phone" size={16} style={{ color: R.out }} />
      <b style={{ fontSize: 20, letterSpacing: ".04em", fontVariantNumeric: "tabular-nums" }} aria-label={`Phone ${phone10.split("").join(" ")}`}>{groupPhone(phone10)}</b>
      <button type="button" className="crm-btn" onClick={copy} title="Copy number" aria-label="Copy number"
        style={{ display: "inline-flex", gap: 5, alignItems: "center", border: `1px solid ${copied ? R.good : R.line}`, background: copied ? "#e5efe0" : "#fff",
          color: copied ? R.good : R.ink, borderRadius: 9, padding: "6px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        <Icon name={copied ? "check" : "copy"} size={14} />{copied ? "Copied" : "Copy"}
      </button>
      <span role="status" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{copied ? "Number copied" : ""}</span>
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
function autoRetry(rule: CodeMeta | undefined, attempts: number, rules: CrmConfig["retry_rules"]): string | null {
  const max = rules.max_attempts ?? 0; // 0 = never drop
  if (!rule || (max > 0 && attempts + 1 >= max)) return null; // this try drops the lead
  if (rule.next_day_at) {
    const day = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: IST });
    return new Date(`${day}T${rule.next_day_at}:00+05:30`).toISOString();
  }
  return new Date(Date.now() + (rule.hours ?? 3) * 3_600_000).toISOString();
}

/** Status dropdown with the code chips and their colours (a native select can't show them). */
function StatusPicker({ value, onChange }: { value: Code | ""; onChange: (c: Code) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { inUse, meta } = useCrmCodes();
  const cur = meta(value);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    // Focus the chosen option (or the first) so arrow keys work straight away
    (wrap.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? wrap.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); return; } // don't close the whole pop-up
    if (!open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const opts = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    opts[(i + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length]?.focus();
  };
  const k = cur ? KIND[cur.kind] : null;
  return (
    <div ref={wrap} onKeyDown={onKey} style={{ position: "relative" }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="Status" onClick={() => setOpen((o) => !o)}
        style={{ ...inputStyle, display: "flex", gap: 9, alignItems: "center", cursor: "pointer", textAlign: "left", fontFamily: "inherit", minHeight: 42,
          background: k ? k.tint : inputStyle.background, borderColor: k ? k.ring : undefined }}>
        {cur ? <><CodeChip code={cur.code} /><b style={{ color: k!.text }}>{cur.label}</b></> : <span style={{ color: R.mute }}>Choose a status…</span>}
        <span aria-hidden style={{ marginLeft: "auto", color: R.mute, fontSize: 11 }}>▼</span>
      </button>
      {open && (
        <div role="listbox" aria-label="Status" style={{ position: "absolute", zIndex: 5, top: "calc(100% + 6px)", left: 0, right: 0, background: R.card,
          border: `1px solid ${R.line}`, borderRadius: 12, boxShadow: "0 18px 40px -18px rgba(43,33,24,.45)", padding: 6, display: "grid", gap: 2 }}>
          {inUse.map((c) => {
            const kk = KIND[c.kind], on = c.code === value;
            return (
              <button key={c.code} type="button" role="option" aria-selected={on} className="lf-opt" onClick={() => { onChange(c.code); setOpen(false); }}
                style={{ ["--tint" as string]: kk.tint, display: "flex", gap: 10, alignItems: "center", textAlign: "left", width: "100%", fontFamily: "inherit",
                  border: 0, borderLeft: `4px solid ${kk.ring}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer", color: R.ink, background: on ? kk.tint : "transparent" }}>
                <CodeChip code={c.code} big />
                <span style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13.5, color: kk.text }}>{c.label}</b>
                  <div style={{ fontSize: 11.5, color: R.mute }}>{c.rule}</div>
                </span>
                {on && <Icon name="check" size={16} style={{ marginLeft: "auto", color: kk.text }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Siren({ on }: { on: boolean }) {
  return (
    <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden style={{ flex: "none" }}>
      {on && <g className="lf-siren-rays" stroke="#ff6a3d" strokeWidth="3" strokeLinecap="round" opacity=".75">
        <path d="M32 4v7M8 30h7M49 30h7M15 13l5 5M49 13l-5 5" />
      </g>}
      <path className={on ? "lf-siren-dome" : undefined} d="M18 46V34a14 14 0 0 1 28 0v12z" fill={on ? "#e8641b" : "#c2b39c"} />
      <path d="M24 34a8 8 0 0 1 8-8" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".7" />
      <rect x="12" y="46" width="40" height="8" rx="3" fill="#3b2a1e" />
    </svg>
  );
}

/** Next follow-up reminder: what the form is about to set, else what is already saved. */
function Reminder({ at, repName, note, live }: { at: string | null; repName: string | null; note: string; live: boolean }) {
  return (
    <section className={live ? "lf-banner" : undefined} aria-live="polite"
      style={{ background: live ? "linear-gradient(135deg,#fff3e2,#ffe1c4)" : "linear-gradient(150deg,#fbf6ee,#f3eadc)",
        border: `1.5px solid ${live ? "#f0a46b" : R.line}`, borderRadius: 14, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center" }}>
      <Siren on={live} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: live ? "#b3420f" : R.ink }}>Next follow-up reminder</div>
        <div style={{ fontSize: 12.5, marginTop: 1 }}>{at ? <><b>{repName ?? "The team"}</b> will be reminded on</> : note}</div>
        {at && <div style={{ display: "inline-block", marginTop: 6, background: live ? "linear-gradient(135deg,#ff5a1f,#c4622d)" : "#8c5a3c", color: "#fff",
          fontWeight: 800, fontSize: 15.5, padding: "6px 16px", borderRadius: 999, boxShadow: live ? "0 0 18px -2px rgba(255,90,31,.55)" : "none" }}>
          {longDate(at)} at {timeOf(at)}</div>}
        {at && <div style={{ fontSize: 11.5, color: R.mute, marginTop: 5 }}>{note}</div>}
      </div>
    </section>
  );
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

  const { meta } = useCrmCodes();
  const kind = meta(code)?.kind;
  const talked = kind === "callback" || kind === "paid" || kind === "closed";
  const needsNote = kind === "callback" || kind === "paid";
  const noFollowUp = kind === "paid" || kind === "closed";
  const drops = kind === "retry" && !autoRetry(meta(code), l.attempts, cfg.retry_rules);
  const dateOff = noFollowUp || drops;

  const pickStatus = (c: Code) => {
    setCode(c);
    setErr("");
    const k = meta(c)?.kind;
    if (k === "paid" || k === "closed") { setDate(""); setTime(""); return; }
    // "No contact" outcomes pre-fill the automatic retry time unless the rep already chose one
    const auto = k === "retry" && !(date && time) ? autoRetry(meta(c), l.attempts, cfg.retry_rules) : null;
    if (auto) { const p = istParts(auto); setDate(p.date); setTime(p.time); }
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
        callback_at: !dateOff && date && time ? `${date}T${time}:00+05:30` : null,
        amount: Number(amount) || null,
        assigned_to: repId,
        has_guitar: guitar ? guitar === "Yes" : null,
      });
      onSaved(`${l.name || "Lead"} saved as ${code} · ${meta(code)?.label}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Reminder banner: the follow-up being set, else the saved one
  const repName = cfg.reps.find((r) => r.id === repId)?.name ?? null;
  const draftAt = !dateOff && date && time ? new Date(`${date}T${time}:00+05:30`).toISOString() : null;
  const savedAt = ["retry", "callback"].includes(l.status) ? l.next_followup_at : null;
  const reminder = noFollowUp ? { at: null, live: false, note: `No follow-up needed: ${meta(code)?.label}.` }
    : drops ? { at: null, live: false, note: "This try drops the lead: no more follow-ups." }
    : draftAt ? { at: draftAt, live: true, note: "The lead blinks in Follow-up due now 15 minutes before. Saved when you press Save." }
    : savedAt ? { at: savedAt, live: l.status === "callback", note: "Already scheduled. Pick a new date and time above to change it." }
    : { at: null, live: false, note: "No follow-up set yet. Add the date and time above." };

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
            {lbl("Email", false)}
            {/* From the lead sheet's email column; the number is already in the box at the top */}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ ...box, flex: 1, minWidth: 0 }} title={l.email ?? undefined}>
                <Icon name="mail" size={15} style={{ color: R.mute }} />
                {l.email ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.email}</span>
                  : <span style={{ color: "#a8977f" }}>Not in the sheet</span>}
              </div>
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
              <div>{lbl("Status", true)}<StatusPicker value={code} onChange={pickStatus} /></div>
              <label>{lbl("Guitar", talked)}
                <select value={guitar} onChange={(e) => setGuitar(e.target.value)} style={{ ...inputStyle, minHeight: 42 }} aria-label="Guitar">
                  <option value="">—</option><option>Yes</option><option>No</option>
                </select></label>
            </div>
            <div className="lf-2">
              <label>{lbl("Next follow-up date", kind === "callback")}
                <input type="date" value={date} min={istToday()} disabled={dateOff} onChange={(e) => setDate(e.target.value)} aria-label="Next follow-up date"
                  style={{ ...inputStyle, opacity: dateOff ? 0.5 : 1 }} /></label>
              <label>{lbl("Next follow-up time", kind === "callback")}
                <input type="time" value={time} disabled={dateOff} onChange={(e) => setTime(e.target.value)} aria-label="Next follow-up time"
                  style={{ ...inputStyle, opacity: dateOff ? 0.5 : 1 }} /></label>
            </div>
            {kind === "retry" && !drops && <div style={{ fontSize: 12, color: R.mute, marginTop: -6 }}>Filled automatically from the follow-up rules in CRM Settings. Change it if needed.</div>}
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

        <Reminder at={reminder.at} repName={repName} note={reminder.note} live={reminder.live} />
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
