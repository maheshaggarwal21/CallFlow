"use client";

// Right column of the lead sheet: follow-up snapshot, the call-log timeline for this number
// (every rep: forms, WhatsApp sends, re-enquiries, every KoreCall recording).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Call } from "@callflow/shared-types";
import { R } from "@/components/report/kit";
import { audioUrlFor, effectiveFormat } from "@/lib/audioPlayback";
import { api } from "@/lib/api";
import { codeMeta, fmtWhen, statusLabel, type CallInfo, type LeadDetail, type TimelineEntry } from "@/lib/crm";
import { CodeChip, Tag } from "./kit";
import { Icon } from "./icons";

const asCall = (c: CallInfo) => ({ ...c, audio_presigned_url: null }) as unknown as Call;
const KIND_COLOR = { retry: "#9a8770", callback: "#b07a1c", paid: R.good, closed: R.bad } as const;
const IST = "Asia/Kolkata";
const longDate = (d: string | Date) => new Date(d).toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
const timeOf = (d: string | Date) => new Date(d).toLocaleTimeString("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function Card({ icon, title, right, children, tone }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; right?: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, overflow: "hidden", minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", background: tone ?? R.soft, borderBottom: `1px solid ${R.line}` }}>
        <span style={{ color: R.out, display: "inline-flex" }}><Icon name={icon} size={17} /></span>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: R.ink }}>{title}</h3>
        {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
      </header>
      <div style={{ padding: "12px 14px" }}>{children}</div>
    </section>
  );
}

/** Compact recording player: waveform-style seek bar, speed, download. Bars are decorative. */
function Player({ call }: { call: CallInfo }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [mp3, setMp3] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(call.duration_secs);
  const [rate, setRate] = useState(1);
  const url = audioUrlFor(asCall(call), mp3 ? "mp3" : effectiveFormat(asCall(call), "auto"));
  const bars = useMemo(() => {
    let h = 0;
    for (const ch of call.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return Array.from({ length: 46 }, (_, i) => { h = (h * 1103515245 + 12345) >>> 0; return 0.25 + 0.75 * Math.abs(Math.sin(i / 3 + (h % 100) / 40)); });
  }, [call.id]);
  useEffect(() => () => audio.current?.pause(), []);
  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setPlaying(false)); else a.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audio.current, box = e.currentTarget.getBoundingClientRect();
    if (a && d) a.currentTime = ((e.clientX - box.left) / box.width) * d;
  };
  const frac = d ? t / d : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fbf6ee", border: `1px solid ${R.line}`, borderRadius: 11, padding: "6px 10px 6px 6px", marginTop: 8 }}>
      {url && <audio ref={audio} src={url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setD(e.currentTarget.duration)}
        onError={() => { if (!mp3) setMp3(true); }} />}
      <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="crm-btn"
        style={{ width: 34, height: 34, borderRadius: 17, border: 0, background: R.out, color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", flex: "none", boxShadow: "0 4px 10px -5px rgba(232,100,27,.8)" }}>
        {playing ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="2" y="1" width="3" height="10" fill="#fff" /><rect x="7" y="1" width="3" height="10" fill="#fff" /></svg>
          : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3 1l8 5-8 5z" fill="#fff" /></svg>}
      </button>
      <div role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(t)} tabIndex={0} onClick={seek}
        onKeyDown={(e) => { const a = audio.current; if (!a) return; if (e.key === "ArrowRight") a.currentTime += 5; if (e.key === "ArrowLeft") a.currentTime -= 5; }}
        style={{ flex: 1, minWidth: 0, height: 28, display: "flex", alignItems: "center", gap: 2, cursor: "pointer" }}>
        {bars.map((b, i) => <span key={i} style={{ flex: 1, height: `${b * 100}%`, borderRadius: 2, background: i / bars.length <= frac ? R.out : "#d9c9b1", transition: "background .15s" }} />)}
      </div>
      <span style={{ fontSize: 11.5, color: R.mute, fontVariantNumeric: "tabular-nums", minWidth: 74, textAlign: "right" }}>{mmss(t)} / {mmss(d)}</span>
      <button onClick={() => setRate((r) => (r === 1 ? 1.5 : r === 1.5 ? 2 : 1))} title="Playback speed" className="crm-btn"
        style={{ border: `1px solid ${R.line}`, background: R.card, borderRadius: 999, fontSize: 11.5, fontWeight: 700, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit", color: R.ink }}>{rate}x</button>
      {url && <a href={url} download title="Download recording" style={{ color: R.mute, display: "inline-flex" }}><Icon name="download" size={17} /></a>}
    </div>
  );
}

function Audio({ call }: { call: CallInfo }) {
  if (call.audio_state === "ok") return <Player call={call} />;
  return <div style={{ marginTop: 8, fontSize: 12, color: R.mute, background: R.soft, borderRadius: 8, padding: "6px 10px" }}>
    {call.audio_state === "expired" ? "Audio expired (90-day limit)" : "No audio for this recording"}</div>;
}

function Star({ call, isOwner, onChanged }: { call: CallInfo; isOwner: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  if (call.audio_state === "expired" || (!isOwner && !call.keep_audio)) return null;
  const toggle = async () => { setBusy(true); try { await api.post(`/crm/calls/${call.id}/keep`, { keep: !call.keep_audio }); onChanged(); } finally { setBusy(false); } };
  return (
    <button onClick={isOwner ? toggle : undefined} disabled={busy || !isOwner} aria-pressed={call.keep_audio}
      title={call.keep_audio ? "Kept past the 90-day limit" : "Keep this recording past the 90-day limit"}
      style={{ border: 0, background: "none", padding: 0, cursor: isOwner ? "pointer" : "default", color: call.keep_audio ? R.gold : "#cdbba1", display: "inline-flex" }}>
      <Icon name="star" size={15} style={call.keep_audio ? { fill: R.gold } : undefined} /></button>
  );
}

function Entry({ e, first, isOwner, onChanged }: { e: TimelineEntry; first: boolean; isOwner: boolean; onChanged: () => void }) {
  // Contacted entries (a form or a recording) glow; the latest one pulses strongest
  const contacted = e.type === "call" || (e.kind === "call_outcome");
  const dot = (color: string) => (
    <span aria-hidden className={contacted ? (first ? "lf-dot lf-dot-live" : "lf-dot") : undefined}
      style={{ position: "absolute", left: -22, top: 3, width: 13, height: 13, borderRadius: 7, background: contacted ? color : R.card,
        border: `2.5px solid ${contacted ? "#fff" : color}`, ["--c" as string]: color } as React.CSSProperties} />
  );
  const head = (icon: ReactNode, title: ReactNode, by: string | null, right: ReactNode) => (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      {icon}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div>
        {by && <div style={{ fontSize: 12, color: R.mute }}>By: <b style={{ color: R.ink, fontWeight: 600 }}>{by}</b></div>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{right}</div>
    </div>
  );
  const when = (at: string) => `${longDate(at)}, ${timeOf(at)}`;
  const box = { position: "relative" as const, background: first ? "#fff7ec" : R.card, border: `1px solid ${first ? "#efd9b8" : R.line}`, borderRadius: 12, padding: "10px 12px" };

  if (e.type === "call") {
    return (
      <li style={box}>{dot("#9a8770")}
        {head(<span style={{ color: "#9a8770", marginTop: 1 }}><Icon name="phone" /></span>, when(e.at), e.call.employee_name,
          <><Tag tone="gold" title="A recording of this number with no form saved against it">No form</Tag>
            <b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{mmss(e.call.duration_secs)}</b><Star call={e.call} isOwner={isOwner} onChanged={onChanged} /></>)}
        <Audio call={e.call} />
      </li>
    );
  }
  if (e.kind === "whatsapp") {
    return (
      <li style={{ ...box, background: "#f1f7ee", borderColor: "#d5e6cd" }}>{dot(R.good)}
        {head(<span style={{ color: R.good, marginTop: 1 }}><Icon name="chat" /></span>, <>WhatsApp: {e.template_label ?? "template"}</>, e.employee_name,
          <><span style={{ fontSize: 12, color: R.mute }}>{timeOf(e.at)}</span>{e.meta?.mode === "mock" && <Tag>mock</Tag>}</>)}
        {e.note && <p style={{ margin: "6px 0 0", fontSize: 12, color: R.mute, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{e.note}</p>}
      </li>
    );
  }
  if (e.kind === "reenquiry" || e.kind === "system") {
    return (
      <li style={{ ...box, background: R.soft, borderStyle: "dashed" }}>{dot(R.gold)}
        <div style={{ fontSize: 12.5 }}><b>{e.kind === "reenquiry" ? "Re-enquired" : "System"}</b> · <span style={{ color: R.mute }}>{e.note} · {when(e.at)}</span></div>
      </li>
    );
  }
  const m = codeMeta(e.code);
  const color = m ? KIND_COLOR[m.kind] : R.mute;
  return (
    <li style={box}>{dot(color)}
      {head(<span style={{ color, marginTop: 1 }}><Icon name="phone" /></span>, when(e.at), e.employee_name,
        <>{e.call && <b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{mmss(e.call.duration_secs)}</b>}
          <CodeChip code={e.code} title={m?.label} />{e.call && <Star call={e.call} isOwner={isOwner} onChanged={onChanged} />}</>)}
      <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.45 }}>
        <b style={{ color }}>{m?.label}</b>{e.reason && <> · {e.reason}</>}
        {e.note && <div style={{ color: R.ink }}>{e.note}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        {e.next_followup_at && <Tag tone="gold">↻ Follow-up {fmtWhen(e.next_followup_at)}</Tag>}
      </div>
      {e.call ? <Audio call={e.call} /> : <div style={{ marginTop: 8, fontSize: 12, color: R.mute, background: R.soft, borderRadius: 8, padding: "6px 10px" }}>No recording found</div>}
    </li>
  );
}

export function Snapshot({ d }: { d: LeadDetail }) {
  const l = d.lead;
  const m = codeMeta(l.current_code);
  const row = (icon: Parameters<typeof Icon>[0]["name"], k: string, v: ReactNode, color?: string, hint?: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "22px 1fr auto", gap: 8, alignItems: "center", padding: "7px 0", borderTop: "1px solid #f1e8da", fontSize: 13 }}>
      <span style={{ color: R.out, display: "inline-flex" }}><Icon name={icon} size={16} /></span>
      <span style={{ color: R.mute }}>{k}{hint && <div style={{ fontSize: 11, color: "#a8977f" }}>{hint}</div>}</span>
      <span style={{ textAlign: "right", fontWeight: 700, color: color ?? R.ink }}>{v}</span>
    </div>
  );
  const f = l.next_followup_at;
  return (
    <Card icon="calendar" title="Follow-up snapshot">
      <div style={{ marginTop: -7 }}>
        {row("target", "Status", statusLabel(l), m ? KIND_COLOR[m.kind] : undefined)}
        {row("calendar", "Next follow-up date", f ? longDate(f) : "—", f ? R.out : undefined)}
        {row("clock", "Next follow-up time", f ? timeOf(f) : "—", f ? R.out : undefined)}
        {row("user", "Assigned to", l.assigned_to_name ?? "—")}
      </div>
    </Card>
  );
}

const HIST_CSS = `
  .lf-dot{box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent),0 0 10px color-mix(in srgb,var(--c) 70%,transparent)}
  .lf-dot-live{animation:lf-glow 1.6s ease-in-out infinite}
  @keyframes lf-glow{0%,100%{box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 25%,transparent),0 0 8px color-mix(in srgb,var(--c) 60%,transparent)}
    50%{box-shadow:0 0 0 7px color-mix(in srgb,var(--c) 12%,transparent),0 0 20px color-mix(in srgb,var(--c) 90%,transparent)}}
  @media (prefers-reduced-motion: reduce){.lf-dot-live{animation:none}}
`;

export function History({ d, isOwner, onChanged }: { d: LeadDetail; isOwner: boolean; onChanged: () => void }) {
  const calls = d.timeline.filter((e) => (e.type === "call" ? true : !!e.call)).length;
  return (
    <>
    <style>{HIST_CSS}</style>
    <Card icon="chart" title="Lead history (call log)" right={<span style={{ fontSize: 12, fontWeight: 700, background: "#f8ead2", color: "#8a5a12", padding: "3px 10px", borderRadius: 999 }}>Total calls: {calls}</span>}>
      {d.timeline.length === 0 ? <p style={{ margin: 0, color: R.mute, fontSize: 13 }}>Never called. You're the first.</p> : (
        <ol style={{ listStyle: "none", margin: 0, padding: "0 0 0 22px", display: "grid", gap: 8, position: "relative", borderLeft: `2px solid ${R.line}`, marginLeft: 6 }}>
          {d.timeline.map((e, i) => <Entry key={e.type === "call" ? `c-${e.call.id}` : `i-${e.id}`} e={e} first={i === 0} isOwner={isOwner} onChanged={onChanged} />)}
        </ol>
      )}
    </Card>
    </>
  );
}
