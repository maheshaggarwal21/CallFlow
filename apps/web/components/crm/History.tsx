"use client";

// Right column of the lead drawer: the snapshot and the full history of this number,
// across every rep — forms, WhatsApp sends, re-enquiries and every KoreCall recording.
import { useState } from "react";
import type { Call } from "@callflow/shared-types";
import AudioPlayer from "@/components/ui/AudioPlayer";
import { Avatar, Panel, R, dur } from "@/components/report/kit";
import { FORMAT_LABEL, audioUrlFor, effectiveFormat } from "@/lib/audioPlayback";
import { api } from "@/lib/api";
import { CHECK_LABEL, STATUS_LABEL, codeMeta, fmtAgo, fmtWhen, type CallInfo, type LeadDetail, type TimelineEntry } from "@/lib/crm";
import { CodeChip, Tag } from "./kit";

const asCall = (c: CallInfo) => ({ ...c, audio_presigned_url: null }) as unknown as Call;

function Recording({ call, isOwner, onChanged }: { call: CallInfo; isOwner: boolean; onChanged: () => void }) {
  const [mp3, setMp3] = useState(false);
  const [busy, setBusy] = useState(false);
  const fmt = mp3 ? "mp3" : effectiveFormat(asCall(call), "auto");
  const star = async () => {
    setBusy(true);
    try { await api.post(`/crm/calls/${call.id}/keep`, { keep: !call.keep_audio }); onChanged(); } finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: R.mute }}>
        <span>☎ {call.direction === "inbound" ? "Inbound" : "Outbound"} · <b style={{ color: R.ink }}>{dur(call.duration_secs)}</b> · {fmtWhen(call.called_at)}</span>
        {call.check && <Tag tone={call.check.label === "possible_conversation" ? "ok" : "neu"} title={`Call check (preview data) · confidence ${Math.round(call.check.confidence * 100)}%`}>
          Call check: {CHECK_LABEL[call.check.label] ?? call.check.label}</Tag>}
        {isOwner && call.audio_state !== "expired" && (
          <button onClick={star} disabled={busy} title={call.keep_audio ? "Kept past the 90-day limit · click to un-star" : "Keep this recording past the 90-day limit"}
            style={{ marginLeft: "auto", border: 0, background: "none", cursor: "pointer", fontSize: 16, color: call.keep_audio ? R.gold : "#c2b39c" }}>
            {call.keep_audio ? "★" : "☆"}</button>
        )}
        {!isOwner && call.keep_audio && <span title="Kept past the 90-day limit" style={{ marginLeft: "auto", color: R.gold }}>★</span>}
      </div>
      {call.audio_state === "ok" ? (
        <AudioPlayer url={audioUrlFor(asCall(call), fmt)} storageId={call.id} formatLabel={FORMAT_LABEL[fmt]} onError={() => setMp3(true)} />
      ) : (
        <div style={{ fontSize: 12.5, color: R.mute, background: R.soft, borderRadius: 8, padding: "7px 10px" }}>
          {call.audio_state === "expired" ? "Audio expired (90-day limit)" : "No audio for this recording"}
        </div>
      )}
    </div>
  );
}

function Entry({ e, isOwner, onChanged }: { e: TimelineEntry; isOwner: boolean; onChanged: () => void }) {
  const box = { background: R.card, border: `1px solid ${R.line}`, borderRadius: 12, padding: "11px 13px" } as const;
  if (e.type === "call") {
    return (
      <li style={box}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Avatar name={e.call.employee_name ?? "?"} size={26} />
          <b style={{ fontSize: 13.5 }}>{e.call.employee_name ?? "Unknown rep"}</b>
          <span style={{ fontSize: 12.5, color: R.mute }}>recording · {fmtAgo(e.at)}</span>
          <span style={{ marginLeft: "auto" }}><Tag tone="gold" title="A recording of this number with no form saved against it">No form</Tag></span>
        </div>
        <Recording call={e.call} isOwner={isOwner} onChanged={onChanged} />
      </li>
    );
  }
  if (e.kind === "whatsapp") {
    return (
      <li style={{ ...box, background: "#f4f8f1" }}>
        <div style={{ fontSize: 13.5 }}><b>WhatsApp: {e.template_label ?? "template"}</b>, sent by {e.employee_name ?? "—"}
          <span style={{ color: R.mute, fontSize: 12.5 }}> · {fmtAgo(e.at)}</span>
          {e.meta?.mode === "mock" && <span style={{ marginLeft: 6 }}><Tag>mock</Tag></span>}</div>
        {e.note && <p style={{ margin: "6px 0 0", fontSize: 12.5, color: R.mute, whiteSpace: "pre-wrap" }}>{e.note}</p>}
      </li>
    );
  }
  if (e.kind === "reenquiry" || e.kind === "system") {
    return (
      <li style={{ ...box, background: R.soft, borderStyle: "dashed" }}>
        <div style={{ fontSize: 13.5 }}><b>{e.kind === "reenquiry" ? "Re-enquired" : "System"}</b> · <span style={{ color: R.mute }}>{e.note}</span>
          <span style={{ color: R.mute, fontSize: 12.5 }}> · {fmtAgo(e.at)}</span></div>
      </li>
    );
  }
  const m = codeMeta(e.code);
  return (
    <li style={{ ...box, ...(e.contradiction ? { borderColor: "#e8c4bd" } : {}) }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Avatar name={e.employee_name ?? "?"} size={26} />
        <b style={{ fontSize: 13.5 }}>{e.employee_name ?? "—"}</b>
        <span style={{ fontSize: 12.5, color: R.mute }} title={new Date(e.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}>{fmtWhen(e.at)}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
          <CodeChip code={e.code} /><span style={{ fontSize: 12.5, fontWeight: 600 }}>{m?.label}</span>
        </span>
      </div>
      {(e.reason || e.note) && (
        <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
          {e.reason && <span style={{ fontWeight: 600 }}>{e.reason}</span>}{e.reason && e.note && " · "}{e.note}
        </div>
      )}
      {e.next_followup_at && <div style={{ fontSize: 12.5, color: "#8a5a12", marginTop: 4 }}>↻ Follow-up {fmtWhen(e.next_followup_at)}</div>}
      {e.contradiction && e.call?.check && (
        <div role="note" style={{ marginTop: 6, fontSize: 12.5, color: R.bad, fontWeight: 600 }}>
          ! Code {e.code} disagrees with the call check ({CHECK_LABEL[e.call.check.label]})
        </div>
      )}
      {e.call ? <Recording call={e.call} isOwner={isOwner} onChanged={onChanged} />
        : <div style={{ marginTop: 8, fontSize: 12.5, color: R.mute, background: R.soft, borderRadius: 8, padding: "7px 10px" }}>No recording found</div>}
    </li>
  );
}

export function Snapshot({ d }: { d: LeadDetail }) {
  const l = d.lead;
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderTop: `1px solid #f1e8da`, fontSize: 13 }}>
      <span style={{ color: R.mute }}>{k}</span><span style={{ textAlign: "right", fontWeight: 600 }}>{v}</span>
    </div>
  );
  return (
    <Panel title="Snapshot">
      <div>
        {row("Status", <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><CodeChip code={l.current_code} />{STATUS_LABEL[l.status] ?? l.status}</span>)}
        {row("Next follow-up", l.next_followup_at ? fmtWhen(l.next_followup_at) : "—")}
        {l.status === "callback" && row("Callback set by", <span>{l.callback_set_by_name ?? "—"}{l.student_set_time && <span style={{ color: R.mute, fontWeight: 400 }}> · student asked for this time</span>}</span>)}
        {row("Failed attempts", `${l.attempts} of 6`)}
        {row("Last contacted", fmtAgo(l.last_contacted_at))}
        {row("Lead created", fmtWhen(l.created_at))}
        {l.answers?.length > 0 && row("Answers", <span style={{ fontWeight: 400 }}>{l.answers.map((a) => `${a.label} ${a.value}`).join(" · ")}</span>)}
      </div>
    </Panel>
  );
}

export function History({ d, isOwner, onChanged }: { d: LeadDetail; isOwner: boolean; onChanged: () => void }) {
  return (
    <Panel title="History" sub={`Every form, message and recording for this number, all reps · ${d.timeline.length} entries`}>
      {d.timeline.length === 0 ? <p style={{ margin: 0, color: R.mute, fontSize: 13 }}>Never called. You're the first.</p> : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {d.timeline.map((e, i) => <Entry key={e.type === "call" ? `c-${e.call.id}` : `i-${e.id}`} e={e} isOwner={isOwner} onChanged={onChanged} />)}
        </ol>
      )}
    </Panel>
  );
}
