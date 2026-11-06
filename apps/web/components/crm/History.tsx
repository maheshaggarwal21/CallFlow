"use client";

// Right column of the lead sheet: follow-up snapshot, the call-log timeline for this number
// (every rep: forms, WhatsApp sends, re-enquiries, every KoreCall recording) and the next follow-up.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Call } from "@callflow/shared-types";
import { R, dur } from "@/components/report/kit";
import { audioUrlFor, effectiveFormat } from "@/lib/audioPlayback";
import { api } from "@/lib/api";
import { CHECK_LABEL, STATUS_LABEL, codeMeta, fmtWhen, type CallInfo, type LeadDetail, type TimelineEntry } from "@/lib/crm";
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
  const dot = (color: string) => (
    <span aria-hidden style={{ position: "absolute", left: -21, top: 4, width: 11, height: 11, borderRadius: 6, background: first ? color : R.card,
      border: `2.5px solid ${color}`, boxShadow: first ? `0 0 0 4px ${color}22` : "none" }} />
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
        {e.call.check && <div style={{ marginTop: 6 }}><Tag>Call check: {CHECK_LABEL[e.call.check.label]}</Tag></div>}
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
    <li style={{ ...box, ...(e.contradiction ? { borderColor: "#e8c4bd" } : {}) }}>{dot(color)}
      {head(<span style={{ color, marginTop: 1 }}><Icon name="phone" /></span>, when(e.at), e.employee_name,
        <>{e.call && <b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{mmss(e.call.duration_secs)}</b>}
          <CodeChip code={e.code} title={m?.label} />{e.call && <Star call={e.call} isOwner={isOwner} onChanged={onChanged} />}</>)}
      <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.45 }}>
        <b style={{ color }}>{m?.label}</b>{e.reason && <> · {e.reason}</>}
        {e.note && <div style={{ color: R.ink }}>{e.note}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        {e.next_followup_at && <Tag tone="gold">↻ Follow-up {fmtWhen(e.next_followup_at)}</Tag>}
        {e.call?.check && <Tag tone={e.call.check.label === "possible_conversation" ? "ok" : "neu"} title={`Preview data · ${Math.round(e.call.check.confidence * 100)}% confidence`}>Call check: {CHECK_LABEL[e.call.check.label]}</Tag>}
        {e.contradiction && <Tag tone="bad">! {e.code} disagrees with the call check</Tag>}
      </div>
      {e.call ? <Audio call={e.call} /> : <div style={{ marginTop: 8, fontSize: 12, color: R.mute, background: R.soft, borderRadius: 8, padding: "6px 10px" }}>No recording found</div>}
    </li>
  );
}

export function Snapshot({ d }: { d: LeadDetail }) {
  const l = d.lead;
  const m = codeMeta(l.current_code);
  const row = (icon: Parameters<typeof Icon>[0]["name"], k: string, v: ReactNode, color?: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "22px 1fr auto", gap: 8, alignItems: "center", padding: "7px 0", borderTop: "1px solid #f1e8da", fontSize: 13 }}>
      <span style={{ color: R.out, display: "inline-flex" }}><Icon name={icon} size={16} /></span>
      <span style={{ color: R.mute }}>{k}</span>
      <span style={{ textAlign: "right", fontWeight: 700, color: color ?? R.ink }}>{v}</span>
    </div>
  );
  const f = l.next_followup_at;
  return (
    <Card icon="calendar" title="Follow-up snapshot">
      <div style={{ marginTop: -7 }}>
        {row("target", "Status", <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><CodeChip code={l.current_code} />{m ? m.label : STATUS_LABEL[l.status]}</span>, m ? KIND_COLOR[m.kind] : undefined)}
        {row("calendar", "Next follow-up date", f ? longDate(f) : "—", f ? R.out : undefined)}
        {row("clock", "Next follow-up time", f ? timeOf(f) : "—", f ? R.out : undefined)}
        {row("user", "Callback set by", l.callback_set_by_name ?? "—")}
        {row("retry", "Failed attempts", `${l.attempts} of 6`)}
        {row("phone", "Last contacted", l.last_contacted_at ? fmtWhen(l.last_contacted_at) : "Never")}
      </div>
    </Card>
  );
}

export function History({ d, isOwner, onChanged }: { d: LeadDetail; isOwner: boolean; onChanged: () => void }) {
  const calls = d.timeline.filter((e) => (e.type === "call" ? true : !!e.call)).length;
  return (
    <Card icon="chart" title="Lead history (call log)" right={<span style={{ fontSize: 12, fontWeight: 700, background: "#f8ead2", color: "#8a5a12", padding: "3px 10px", borderRadius: 999 }}>Total calls: {calls}</span>}>
      {d.timeline.length === 0 ? <p style={{ margin: 0, color: R.mute, fontSize: 13 }}>Never called. You're the first.</p> : (
        <ol style={{ listStyle: "none", margin: 0, padding: "0 0 0 22px", display: "grid", gap: 8, position: "relative", borderLeft: `2px solid ${R.line}`, marginLeft: 6 }}>
          {d.timeline.map((e, i) => <Entry key={e.type === "call" ? `c-${e.call.id}` : `i-${e.id}`} e={e} first={i === 0} isOwner={isOwner} onChanged={onChanged} />)}
        </ol>
      )}
    </Card>
  );
}

/** What happens next for this lead, in one glance. */
export function NextUp({ d }: { d: LeadDetail }) {
  const l = d.lead;
  const big = (text: string, bg: string) => <div style={{ display: "inline-block", marginTop: 10, background: bg, color: "#fff", fontWeight: 800, fontSize: 17, padding: "9px 18px", borderRadius: 999, boxShadow: "0 8px 18px -10px rgba(0,0,0,.5)" }}>{text}</div>;
  let body: ReactNode;
  if (l.status === "callback" && l.next_followup_at) {
    body = <>
      <div style={{ fontSize: 13 }}>Callback set by <b>{l.callback_set_by_name ?? "—"}</b>{l.student_set_time ? " · the student asked for this time" : ""}</div>
      {big(`${longDate(l.next_followup_at)} at ${timeOf(l.next_followup_at)}`, `linear-gradient(135deg,${R.out},#c4622d)`)}
      <div style={{ fontSize: 11.5, color: R.mute, marginTop: 8 }}>Blinks in "Due now" for every rep 15 minutes before.</div>
    </>;
  } else if (l.status === "retry" && l.next_followup_at) {
    body = <><div style={{ fontSize: 13 }}>Back in the Retry list after the wait</div>{big(`${longDate(l.next_followup_at)} at ${timeOf(l.next_followup_at)}`, "#8c5a3c")}</>;
  } else if (l.status === "converted") {
    body = <><div style={{ fontSize: 13 }}>Paid trial. Schedule the first class.</div>{big(`₹${Number(l.amount ?? 299)} paid`, R.good)}</>;
  } else if (l.status === "dnc") {
    body = <div style={{ fontSize: 13 }}>Closed: the student asked not to be called again.</div>;
  } else if (l.status === "dropped") {
    body = <div style={{ fontSize: 13 }}>Dropped after {l.attempts} failed attempts. The owner can revive it.</div>;
  } else {
    body = <><div style={{ fontSize: 13 }}>Fresh lead, not called yet</div>{big("Call now", "#8c5a3c")}</>;
  }
  return (
    <section style={{ background: "linear-gradient(150deg,#fff6e6,#fbe9cf)", border: `1px solid #efd9b8`, borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "flex-start" }}>
      <span style={{ color: R.out, background: "#fff", borderRadius: 12, padding: 10, display: "inline-flex", boxShadow: "0 6px 14px -10px rgba(140,63,18,.6)" }}><Icon name="bell" size={24} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#8c3f12" }}>Next follow-up</div>
        {body}
      </div>
    </section>
  );
}
