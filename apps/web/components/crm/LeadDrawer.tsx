"use client";

// The lead form ("Lead follow-up") as a compact pop-up, kept simple on the client's request:
// the form alone by default; the side handle opens the follow-up snapshot and call log beside it.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import useSWR from "swr";
import { R } from "@/components/report/kit";
import { API_BASE, api, fetcher } from "@/lib/api";
import { MIN_NOTE, fillTemplate, groupPhone, openWati, type Code, type CodeMeta, type CrmConfig, type LeadDetail, type WatiTemplates } from "@/lib/crm";
import { useCrmCodes } from "@/hooks/useCrmCodes";
import { useAuth } from "@/hooks/useAuth";
import { WatiIcon, WhatsAppIcon } from "@/components/ui/WABtn";
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
  .wt-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
  .wt-grid.on{grid-template-columns:minmax(0,1.35fr) minmax(260px,1fr)}
  @media (max-width:760px){.wt-grid.on{grid-template-columns:minmax(0,1fr)}}
  @media (prefers-reduced-motion: reduce){.lf-siren-dome,.lf-siren-rays,.lf-banner{animation:none}}
`;

/** Status colours, the same families as the code chips: retry beige, callback gold, paid green, closed red. */
const KIND = {
  retry: { tint: "#f4ece0", ring: "#b9a68e", text: "#7a6650" },
  callback: { tint: "#fdf1da", ring: R.gold, text: "#8a5a12" },
  paid: { tint: "#e8f2e3", ring: R.good, text: R.good },
  closed: { tint: "#fbe7e3", ring: R.bad, text: R.bad },
  other: { tint: "#e9f2f9", ring: "#5b8db8", text: "#2f6690" },
  unused: { tint: "#f1ede6", ring: "#c9bfb1", text: "#8f8577" },
} as const;

const received = (d: string) => new Date(d).toLocaleString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
const longDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
const timeOf = (d: string) => new Date(d).toLocaleTimeString("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });
/** ISO → IST "YYYY-MM-DD" and "HH:MM" for the date and time inputs. */
const istParts = (iso: string) => { const [d, t] = new Date(iso).toLocaleString("sv-SE", { timeZone: IST }).split(" "); return { date: d, time: t.slice(0, 5) }; };
const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: IST });

export default function LeadDrawer({ leadId, presetCode, onClose, onSaved, isOwner }: {
  leadId: string | null; presetCode?: string | null; onClose: () => void; onSaved: (msg: string) => void; isOwner: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Modal open={!!leadId} onClose={onClose} label="Lead" width={expanded ? 1340 : 820}>
      {leadId && <DrawerBody key={leadId} leadId={leadId} presetCode={presetCode ?? null} onClose={onClose} onSaved={onSaved} isOwner={isOwner} expanded={expanded} onExpand={setExpanded} />}
    </Modal>
  );
}

function DrawerBody({ leadId, presetCode, onClose, onSaved, isOwner, expanded, onExpand }: {
  leadId: string; presetCode: string | null; onClose: () => void; onSaved: (msg: string) => void; isOwner: boolean; expanded: boolean; onExpand: (v: boolean) => void;
}) {
  const { data: d, error, mutate } = useSWR<LeadDetail>(`/crm/leads/${leadId}`, fetcher, { refreshInterval: 30_000 });
  const { data: cfg } = useSWR<CrmConfig>("/crm/config", fetcher);
  const [lock, setLock] = useState<Lock>(null);
  const [watiErr, setWatiErr] = useState("");
  // shared with WatiSend below (SWR dedupes it): no WATI set up on the server = no WATI button
  const { data: wati } = useSWR<WatiTemplates>("/crm/wati/templates", fetcher, { revalidateOnFocus: false });
  const watiOn = !!(wati?.configured && wati.inbox);
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
        {/* Client, 8 Nov: WhatsApp top right; the number lives in Basic details; no Close button
            (a click on the empty area around the pop-up, or Esc, closes it) */}
        {/* Client, 12 Nov: WATI beside WhatsApp, opening this number's chat in WATI */}
        {watiOn && <button type="button" className="crm-btn" title="Open this chat in WATI" onClick={() => { setWatiErr(""); openWati(d.lead.id).catch((e) => setWatiErr((e as Error).message)); }}
          style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center", background: "#fff", color: "#1d1d1b", border: `1px solid ${R.line}`, borderRadius: 12,
            padding: "9px 18px", fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
          <WatiIcon size={22} />wati</button>}
        <a href={`https://wa.me/91${d.lead.phone10}`} target="_blank" rel="noopener noreferrer" className="crm-btn" title="Chat on WhatsApp"
          style={{ ...(watiOn ? {} : { marginLeft: "auto" }), display: "inline-flex", gap: 8, alignItems: "center", background: "#25D366", color: "#fff", borderRadius: 12,
            padding: "10px 18px", fontWeight: 800, fontSize: 14, textDecoration: "none", boxShadow: "0 8px 18px -10px rgba(37,211,102,.9)" }}>
          <WhatsAppIcon size={18} />WhatsApp</a>
      </header>
      {watiErr && <p role="alert" style={{ margin: 0, color: R.bad, fontSize: 13 }}>WATI: {watiErr}</p>}
      <WatiSend lead={d.lead} readOnly={readOnly} onSent={() => mutate()} />
      {readOnly && (
        <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", background: "#fff1d6", border: `1px solid ${R.gold}`, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="lock" size={18} style={{ color: "#8a5a12" }} />
          {lock?.locked_by_name} is on this lead. You can read it, but the form is read-only until they save or close.
        </div>
      )}
      <div className={`lf-grid${expanded ? " open" : ""}`}>
        <LeadForm d={d} cfg={cfg} presetCode={presetCode} readOnly={readOnly} onSaved={(m) => { mutate(); onSaved(m); onClose(); }} onReload={() => mutate()} />
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

/**
 * Send an approved WATI template to the lead: pick it from the dropdown, read the preview with the
 * lead's details filled in, then Send. Nothing is sent until a template is chosen and Send is pressed.
 */
function WatiSend({ lead, readOnly, onSent }: { lead: LeadDetail["lead"]; readOnly: boolean; onSent: () => void }) {
  const { data, error } = useSWR<WatiTemplates>("/crm/wati/templates", fetcher, { revalidateOnFocus: false });
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  // On by default so the message is seen before it is sent; the Preview button hides or shows it
  const [preview, setPreview] = useState(true);
  if (data && !data.configured) return null;
  const t = data?.templates.find((x) => x.name === name);
  const pick = (n: string) => {
    setName(n);
    setState({});
    const next = data?.templates.find((x) => x.name === n);
    // the first variable is the person's name in the school's templates; the rest start from WATI's sample text
    setValues(Object.fromEntries((next?.params ?? []).map((p, i) => [p.name, i === 0 || /name/i.test(p.name) ? lead.name || p.sample : p.sample])));
  };
  const send = async () => {
    if (!t) return;
    setState({ busy: true });
    try {
      const r = await api.post<{ mode: "sent" | "dry-run" }>(`/crm/leads/${lead.id}/whatsapp`, { template: t.name, values });
      setState({ ok: r.mode === "sent" ? `Sent “${t.name}” to ${groupPhone(lead.phone10)}.` : `Test mode: “${t.name}” was NOT sent (this is the local copy). It will send on the live site.` });
      setName("");
      onSent();
    } catch (e) {
      setState({ err: (e as Error).message });
    }
  };
  const vars = t?.params ?? [];
  const now = new Date().toLocaleTimeString("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 12, padding: "12px 14px" }}>
      <div className={`wt-grid${t && preview ? " on" : ""}`}>
        <div style={{ display: "grid", gap: 10, alignContent: "start", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 800, fontSize: 15, color: R.ink }}><WatiIcon size={24} />Send WATI Template (WhatsApp)</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: R.good, background: "#e5efe0", borderRadius: 999, padding: "3px 10px" }}>
              {data?.dry_run ? "Test mode: nothing is sent from this local copy" : "Send registered templates directly from WATI"}</span>
          </div>
          <div>
            <span style={labelStyle}>Template <span style={{ color: R.bad }}>*</span></span>
            <div style={{ display: "flex", gap: 10 }}>
              <select aria-label="WhatsApp template" value={name} disabled={readOnly || !data} onChange={(e) => pick(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }}>
                <option value="">{error ? "Templates could not be loaded" : !data ? "Loading templates…" : "Select template"}</option>
                {data?.templates.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
              </select>
              {/* Toggles the preview beside the form */}
              <button type="button" className="crm-btn" onClick={() => setPreview(!preview)} disabled={!t} aria-pressed={preview}
                style={{ display: "inline-flex", gap: 7, alignItems: "center", border: `1px solid ${preview && t ? R.out : R.line}`, background: preview && t ? "#fdf1e7" : "#fff",
                  color: preview && t ? R.out : R.ink, borderRadius: 9, padding: "0 14px", fontWeight: 700, fontSize: 13.5, fontFamily: "inherit", cursor: t ? "pointer" : "default", opacity: t ? 1 : 0.5 }}>
                <Icon name="eye" size={17} />Preview</button>
            </div>
          </div>
          {error && <p role="alert" style={{ margin: 0, color: R.bad, fontSize: 13 }}>{(error as Error).message}</p>}
          {t && (
            <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 240px", background: R.soft, borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8, alignContent: "start" }}>
                <span style={{ ...labelStyle, marginBottom: 0 }}>Template variables (auto-filled)</span>
                {vars.length === 0 ? <span style={{ fontSize: 13, color: R.mute }}>This template has no blanks.</span>
                  : vars.map((p) => (
                    <label key={p.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ flex: "none", fontSize: 12, fontWeight: 700, color: R.bad, background: "#f8e3df", borderRadius: 6, padding: "4px 7px" }}>{`{{${p.name}}}`}</span>
                      <input aria-label={`Value for ${p.name}`} value={values[p.name] ?? ""} maxLength={500} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                        style={{ ...inputStyle, padding: "6px 9px" }} />
                    </label>
                  ))}
              </div>
              <div style={{ flex: "0 1 220px", display: "grid", gap: 8, alignContent: "center" }}>
                <button type="button" className="crm-btn" onClick={send} disabled={readOnly || state.busy}
                  style={{ display: "inline-flex", gap: 9, alignItems: "center", justifyContent: "center", background: R.out, color: "#fff", border: 0, borderRadius: 10,
                    padding: "13px 18px", fontWeight: 800, fontSize: 15, fontFamily: "inherit", cursor: "pointer", opacity: readOnly || state.busy ? 0.6 : 1 }}>
                  <WhatsAppIcon size={18} />{state.busy ? "Sending…" : "Send Template"}</button>
                <span style={{ fontSize: 12, color: R.mute, textAlign: "center" }}>to {groupPhone(lead.phone10)} · <button type="button" onClick={() => pick("")}
                  style={{ border: 0, background: "none", padding: 0, color: R.mute, textDecoration: "underline", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>cancel</button></span>
              </div>
            </div>
          )}
          {state.ok && <p role="status" style={{ margin: 0, color: R.good, fontSize: 13, fontWeight: 600 }}>{state.ok}</p>}
          {state.err && <p role="alert" style={{ margin: 0, color: R.bad, fontSize: 13 }}>{state.err}</p>}
        </div>

        {t && preview && (
          // WhatsApp-style: green chat background, one white message bubble with the filled-in template
          <aside aria-label="Message preview" style={{ background: "#dcf0d2", borderRadius: 12, padding: "10px 12px", display: "grid", gap: 8, alignContent: "start", minWidth: 0 }}>
            <span style={{ display: "inline-flex", gap: 7, alignItems: "center", fontWeight: 800, fontSize: 13.5, color: R.ink }}>
              <span style={{ color: "#25D366", display: "inline-flex" }}><WhatsAppIcon size={18} /></span>Template Preview</span>
            <div style={{ background: "#fff", borderRadius: "4px 12px 12px 12px", padding: "9px 11px 6px", boxShadow: "0 1px 1px rgba(0,0,0,.08)", fontSize: 13.5, lineHeight: 1.45,
              whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 300, overflowY: "auto" }}>
              {t.header && <b style={{ display: "block", marginBottom: 4 }}>{t.header}</b>}
              {fillTemplate(t.body, values)}
              {t.footer && <span style={{ display: "block", marginTop: 6, fontSize: 12.5, color: R.mute }}>{t.footer}</span>}
              <span style={{ display: "block", textAlign: "right", fontSize: 11, color: R.mute, marginTop: 2 }}>{now}</span>
            </div>
            {t.buttons.map((b) => (
              <span key={b} style={{ background: "#fff", borderRadius: 10, padding: "7px 10px", textAlign: "center", fontSize: 13.5, fontWeight: 600, color: "#1f8fd6" }}>{b}</span>
            ))}
          </aside>
        )}
      </div>
    </section>
  );
}

/** Contact field: the number in bold for dialling on KoreCall, with a copy button. */
function ContactField({ phone10 }: { phone10: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(phone10); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div style={{ ...inputStyle, background: "#f7f2ea", display: "flex", gap: 8, alignItems: "center", padding: "4px 4px 4px 12px", minHeight: 42 }}>
      <Icon name="phone" size={15} style={{ color: R.out }} />
      <b style={{ fontSize: 15.5, letterSpacing: ".03em", fontVariantNumeric: "tabular-nums", flex: 1 }} aria-label={`Phone ${phone10.split("").join(" ")}`}>{groupPhone(phone10)}</b>
      <button type="button" className="crm-btn" onClick={copy} title="Copy number" aria-label="Copy number"
        style={{ display: "inline-flex", gap: 5, alignItems: "center", border: `1px solid ${copied ? R.good : R.line}`, background: copied ? "#e5efe0" : "#fff",
          color: copied ? R.good : R.ink, borderRadius: 8, padding: "5px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        <Icon name={copied ? "check" : "copy"} size={14} />{copied ? "Copied" : "Copy"}
      </button>
      <span role="status" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{copied ? "Number copied" : ""}</span>
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
  // The list is fixed to the screen (the form's cards clip anything that sticks out of them): below the
  // field, or above it when there is more room there, as tall as the room allows, scrolling beyond that
  const [place, setPlace] = useState<CSSProperties>({});
  const wrap = useRef<HTMLDivElement>(null);
  const { inUse, meta } = useCrmCodes();
  const toggle = () => {
    if (!open && wrap.current) {
      const f = wrap.current.getBoundingClientRect();
      const below = window.innerHeight - f.bottom - 12, above = f.top - 12;
      const up = below < 280 && above > below;
      setPlace({ left: f.left, width: f.width, maxHeight: Math.max(160, up ? above : below),
        ...(up ? { bottom: window.innerHeight - f.top + 6 } : { top: f.bottom + 6 }) });
    }
    setOpen((o) => !o);
  };
  const cur = meta(value);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    // A fixed list can't follow the form when it scrolls: close it instead (scrolling the list itself is fine)
    const moved = (e: Event) => { if (!wrap.current?.querySelector('[role="listbox"]')?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    // Focus the chosen option (or the first) so arrow keys work straight away
    (wrap.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? wrap.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
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
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="Status" onClick={toggle}
        style={{ ...inputStyle, display: "flex", gap: 9, alignItems: "center", cursor: "pointer", textAlign: "left", fontFamily: "inherit", minHeight: 42,
          background: k ? k.tint : inputStyle.background, borderColor: k ? k.ring : undefined }}>
        {cur ? <><CodeChip code={cur.code} /><b style={{ color: k!.text }}>{cur.label}</b></> : <span style={{ color: R.mute }}>Choose a status…</span>}
        <span aria-hidden style={{ marginLeft: "auto", color: R.mute, fontSize: 11 }}>▼</span>
      </button>
      {open && (
        <div role="listbox" aria-label="Status" style={{ position: "fixed", zIndex: 60, ...place, overflowY: "auto", overscrollBehavior: "contain", background: R.card,
          border: `1px solid ${R.line}`, borderRadius: 12, boxShadow: "0 18px 40px -18px rgba(43,33,24,.45)", padding: 6, display: "grid", gap: 2, alignContent: "start" }}>
          {inUse.map((c) => {
            const kk = KIND[c.kind], on = c.code === value;
            return (
              <button key={c.code} type="button" role="option" aria-selected={on} className="lf-opt" onClick={() => { onChange(c.code); setOpen(false); }}
                style={{ ["--tint" as string]: kk.tint, display: "flex", gap: 10, alignItems: "center", textAlign: "left", width: "100%", fontFamily: "inherit",
                  border: 0, borderLeft: `4px solid ${kk.ring}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", color: R.ink, background: on ? kk.tint : "transparent" }}>
                <CodeChip code={c.code} />
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

function LeadForm({ d, cfg, presetCode, readOnly, onSaved, onReload }: {
  d: LeadDetail; cfg: CrmConfig; presetCode: string | null; readOnly: boolean; onSaved: (m: string) => void; onReload: () => void;
}) {
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
  const [amount, setAmount] = useState(l.amount ? String(Number(l.amount)) : ""); // price varies: no default
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
  // A status picked in the table that needs more (note, date, guitar) arrives here already chosen
  useEffect(() => { if (presetCode) pickStatus(presetCode); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    : kind === "other" ? { at: null, live: false, note: "No follow-up unless you add a date and time above." }
    : savedAt ? { at: savedAt, live: l.status === "callback", note: "Already scheduled. Pick a new date and time above to change it." }
    : { at: null, live: false, note: "No follow-up set yet. Add the date and time above." };

  const stale = /updated by/.test(err);
  const star = (on: boolean) => (on ? <span style={{ color: R.bad }}> *</span> : null);
  const lbl = (text: string, required: boolean) => <span style={labelStyle}>{text}{star(required)}</span>;
  const box = { ...inputStyle, background: "#f7f2ea", display: "flex", gap: 8, alignItems: "center" } as const;
  // Natural height even when the call log beside it is taller (no stretched cards), and pinned while the
  // pop-up scrolls through a long history, so Status and Save stay in view
  return (
    <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 12, minWidth: 0,
      alignContent: "start", alignSelf: "start", position: "sticky", top: 0 }}>
      {/* Client, 8 Nov: segments, everything important in one area of the screen */}
      <Card icon="user" title="Basic details">
        <div style={{ display: "grid", gap: 10 }}>
          <div className="lf-2">
            <div>{lbl("Name", false)}<div style={box}><Icon name="user" size={15} style={{ color: R.mute }} />{l.name || "—"}</div></div>
            <div>{lbl("Contact", false)}<ContactField phone10={l.phone10} /></div>
          </div>
          <div className="lf-2">
            <div>{lbl("Email", false)}
              <div style={box} title={l.email ?? undefined}>
                <Icon name="mail" size={15} style={{ color: R.mute }} />
                {l.email ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.email}</span>
                  : <span style={{ color: "#a8977f" }}>Not in the sheet</span>}
              </div>
            </div>
            <div className="lf-2">
              <label>{lbl("Guitar", talked)}
                <select value={guitar} onChange={(e) => setGuitar(e.target.value)} style={{ ...inputStyle, minHeight: 42 }} aria-label="Guitar">
                  <option value="">—</option><option>Yes</option><option>No</option>
                </select></label>
              <label>{lbl("Amount (₹)", false)}
                <input type="number" min={0} placeholder="e.g. 299" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, minHeight: 42 }} /></label>
            </div>
          </div>
        </div>
      </Card>

      <Card icon="phone" title="Call & follow-up">
        <div style={{ display: "grid", gap: 10 }}>
          <div className="lf-2">
            <div>{lbl("Status", true)}<StatusPicker value={code} onChange={pickStatus} /></div>
            <label>{lbl("Representative (assigned to)", true)}
              <select value={repId} onChange={(e) => setRepId(e.target.value)} style={{ ...inputStyle, minHeight: 42 }} aria-label="Representative">
                <option value="">Choose…</option>
                {cfg.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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
          {kind === "retry" && !drops && <div style={{ fontSize: 12, color: R.mute, marginTop: -4 }}>Filled automatically from the follow-up rules in CRM &amp; Pay Settings. Change it if needed.</div>}
          <label>
            <span style={{ ...labelStyle, display: "flex" }}>Notes / conversation summary{star(needsNote)}
              <span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{note.length} / {NOTE_MAX}</span></span>
            <textarea value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What did the student say?" style={{ ...inputStyle, resize: "vertical" }} />
          </label>
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
        </div>
      </Card>
    </fieldset>
  );
}
