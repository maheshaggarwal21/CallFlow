"use client";

// CRM Settings. Each section is gated by its own permission; the owner sees everything.
// Settings the client still has to confirm carry a "Pending client decision" tag.
import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import { Avatar, Panel, R } from "@/components/report/kit";
import { api, fetcher } from "@/lib/api";
import { CODES, PERMISSION_LABELS, type Code } from "@/lib/crm";
import { useCrmMe } from "@/hooks/useCrmMe";
import { Btn, CRM_CSS, CodeChip, HeaderBand, PendingTag, Tag, inputStyle, labelStyle, tdStyle, thStyle } from "@/components/crm/kit";

type Item = { id: string; label: string; active: boolean; sort_order: number; codes?: Code[]; text?: string; type?: string; options?: string[] };
type Settings = {
  questions: Item[]; reasons: Item[]; note_templates: Item[];
  wati_templates: { id: string; name: string; label: string; body: string; active: boolean }[];
  values: Record<string, any>;
  team: { id: string; name: string; email: string; employee_code: number; permissions: string[] }[] | null;
  permissions: string[]; wati_mode: "mock" | "live"; all_permissions: string[];
};

export default function CrmSettingsPage() {
  const { data, error, mutate } = useSWR<Settings>("/crm/settings", fetcher);
  const { me } = useCrmMe();
  const can = (p: string) => !!data && (me?.is_owner || data.permissions.includes(p));
  const owner = !!me?.is_owner;

  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gap: 14 }}>
      <style>{CRM_CSS}</style>
      <HeaderBand eyebrow="CRM" title="CRM Settings" sub="Lists the reps use in the lead form, follow-up rules and who can do what" />
      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p> : !data ? <p style={{ color: R.mute }}>Loading…</p> : (
        <>
          {!owner && !can("manage_questions") && !can("manage_templates") && (
            <Panel title="Nothing to manage here"><p style={{ margin: 0, color: R.mute, fontSize: 13 }}>Your account has no CRM settings permissions. The owner can grant them under Team permissions.</p></Panel>
          )}
          {can("manage_questions") && (
            <ListEditor title="Questions" sub="Asked on every lead. Edit freely; old answers keep the wording they were saved with. Deactivate instead of deleting."
              path="questions" items={data.questions} onChange={() => mutate()}
              fields={[{ key: "label", label: "Question" }, { key: "type", label: "Type", kind: "type" }, { key: "options", label: "Options (comma separated)", kind: "options" }]} />
          )}
          {can("manage_templates") && (
            <>
              <ListEditor title="Reasons" sub="The reason dropdown, filtered by the chosen code." path="reasons" items={data.reasons} onChange={() => mutate()}
                fields={[{ key: "label", label: "Reason" }, { key: "codes", label: "Codes", kind: "codes" }]} />
              <ListEditor title="Note templates" sub="Quick-note chips, filtered by code. {date} and {time} fill from the callback picker." path="templates" items={data.note_templates} onChange={() => mutate()}
                fields={[{ key: "label", label: "Chip label" }, { key: "text", label: "Text", kind: "textarea" }, { key: "codes", label: "Codes", kind: "codes" }]} />
            </>
          )}
          {owner && (
            <>
              <RetryRules value={data.values.retry_rules} onSaved={() => mutate()} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))", gap: 14, alignItems: "start" }}>
                <DigestSetting value={data.values.digest} onSaved={() => mutate()} />
                <CallCheckSetting value={data.values.call_check} onSaved={() => mutate()} />
              </div>
              <Panel title="WhatsApp (WATI)" sub="Template sends from the lead drawer">
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  {data.wati_mode === "mock" ? <Tag tone="gold">Mock mode: WATI_API_URL / WATI_TOKEN not set, nothing is sent</Tag> : <Tag tone="ok">Live</Tag>}
                  <PendingTag />
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                  {data.wati_templates.map((t) => <li key={t.id} style={{ fontSize: 13 }}><b>{t.label}</b> <code style={{ color: R.mute, fontSize: 12 }}>{t.name}</code><div style={{ color: R.mute, fontSize: 12.5 }}>{t.body}</div></li>)}
                </ul>
              </Panel>
              <TeamPermissions team={data.team ?? []} all={data.all_permissions} onSaved={() => mutate()} />
            </>
          )}
        </>
      )}
    </div>
  );
}

type Field = { key: string; label: string; kind?: "text" | "textarea" | "codes" | "type" | "options" };

function CodePicker({ value, onChange }: { value: Code[]; onChange: (v: Code[]) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {CODES.map((c) => {
        const on = value.includes(c.code);
        return (
          <button key={c.code} type="button" onClick={() => onChange(on ? value.filter((x) => x !== c.code) : [...value, c.code])} aria-pressed={on} title={c.label}
            style={{ border: 0, padding: 0, background: "none", cursor: "pointer", opacity: on ? 1 : 0.3 }}><CodeChip code={c.code} /></button>
        );
      })}
    </div>
  );
}

function FieldInput({ f, v, set }: { f: Field; v: any; set: (v: any) => void }) {
  if (f.kind === "codes") return <CodePicker value={v ?? []} onChange={set} />;
  if (f.kind === "type") return (
    <select value={v ?? "select"} onChange={(e) => set(e.target.value)} style={inputStyle}>
      <option value="yesno">Yes / No</option><option value="select">Pick one</option><option value="text">Free text</option>
    </select>
  );
  if (f.kind === "options") return <input value={(v ?? []).join(", ")} onChange={(e) => set(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} style={inputStyle} />;
  if (f.kind === "textarea") return <textarea value={v ?? ""} onChange={(e) => set(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />;
  return <input value={v ?? ""} onChange={(e) => set(e.target.value)} style={inputStyle} />;
}

function ListEditor({ title, sub, path, items, fields, onChange }: { title: string; sub: string; path: string; items: Item[]; fields: Field[]; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [err, setErr] = useState("");
  const start = (it: Item | null) => {
    setErr("");
    setEditing(it?.id ?? "new");
    setDraft(it ? Object.fromEntries(fields.map((f) => [f.key, (it as any)[f.key]])) : { codes: [], options: [], type: "select" });
  };
  const save = async () => {
    setErr("");
    try {
      const body = Object.fromEntries(fields.map((f) => [f.key, draft[f.key]]));
      if (editing === "new") await api.post(`/crm/settings/${path}`, { ...body, sort_order: items.length + 1 });
      else await api.patch(`/crm/settings/${path}/${editing}`, body);
      setEditing(null);
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const toggle = async (it: Item) => { await api.patch(`/crm/settings/${path}/${it.id}`, { active: !it.active }); onChange(); };
  const form = (
    <div style={{ display: "grid", gap: 10, background: R.soft, borderRadius: 12, padding: 12 }}>
      {fields.map((f) => <label key={f.key} style={{ display: "block" }}><span style={labelStyle}>{f.label}</span><FieldInput f={f} v={draft[f.key]} set={(v) => setDraft({ ...draft, [f.key]: v })} /></label>)}
      {err && <p role="alert" style={{ margin: 0, color: R.bad, fontSize: 13 }}>{err}</p>}
      <div style={{ display: "flex", gap: 8 }}><Btn onClick={save}>Save</Btn><Btn kind="ghost" onClick={() => setEditing(null)}>Cancel</Btn></div>
    </div>
  );
  return (
    <Panel title={title} sub={sub}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((it) => (
          <li key={it.id} style={{ borderTop: "1px solid #f1e8da", padding: "9px 4px" }}>
            {editing === it.id ? form : (
              <div style={{ display: "flex", gap: 10, alignItems: "center", opacity: it.active ? 1 : 0.5 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <b>{it.label}</b>{it.codes?.map((c) => <CodeChip key={c} code={c} />)}{!it.active && <Tag>inactive</Tag>}
                  </div>
                  {(it.text || it.options?.length || it.type) && (
                    <div style={{ fontSize: 12.5, color: R.mute }}>{it.text ?? (it.type === "yesno" ? "Yes / No" : it.type === "text" ? "Free text" : it.options?.join(" · "))}</div>
                  )}
                </div>
                <Btn kind="ghost" onClick={() => start(it)}>Edit</Btn>
                <Btn kind={it.active ? "danger" : "ghost"} onClick={() => toggle(it)}>{it.active ? "Deactivate" : "Activate"}</Btn>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 10 }}>{editing === "new" ? form : <Btn kind="ghost" onClick={() => start(null)}>＋ Add</Btn>}</div>
    </Panel>
  );
}

function SaveRow({ onSave, saved, err }: { onSave: () => void; saved: boolean; err: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
      <Btn onClick={onSave}>Save</Btn>
      {saved && <span role="status" style={{ color: R.good, fontSize: 13, fontWeight: 600 }}>Saved ✓</span>}
      {err && <span role="alert" style={{ color: R.bad, fontSize: 13 }}>{err}</span>}
    </div>
  );
}

function useSave(key: string, onSaved: () => void) {
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t); }, [saved]);
  const save = async (value: unknown) => {
    setErr("");
    try { await api.patch(`/crm/settings/values/${key}`, value); setSaved(true); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  return { save, saved, err };
}

function Title({ children }: { children: ReactNode }) {
  return <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>{children}<PendingTag /></span>;
}

function RetryRules({ value, onSaved }: { value: any; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const { save, saved, err } = useSave("retry_rules", onSaved);
  const rule = (c: "A" | "B" | "C") => v[c] ?? {};
  const setRule = (c: "A" | "B" | "C", r: object) => setV({ ...v, [c]: r });
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "16px 18px" }}>
      <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}><Title>Retry rules</Title></h3>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: R.mute }}>When a lead comes back into the queue after a failed attempt</p>
      <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: 480 }}>
        <thead><tr><th style={thStyle}>Code</th><th style={thStyle}>Wait</th></tr></thead>
        <tbody>
          {(["B", "C", "A"] as const).map((c) => {
            const r = rule(c), nextDay = !!r.next_day_at;
            return (
              <tr key={c}>
                <td style={tdStyle}><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><CodeChip code={c} />{CODES.find((x) => x.code === c)?.label}</span></td>
                <td style={tdStyle}>
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <select value={nextDay ? "next" : "hours"} onChange={(e) => setRule(c, e.target.value === "next" ? { next_day_at: "10:00" } : { hours: 3 })} style={{ ...inputStyle, width: 150 }}>
                      <option value="hours">After hours</option><option value="next">Next day at</option>
                    </select>
                    {nextDay ? <input type="time" value={r.next_day_at} onChange={(e) => setRule(c, { next_day_at: e.target.value })} style={{ ...inputStyle, width: 120 }} />
                      : <><input type="number" min={0.25} step={0.25} value={r.hours ?? 3} onChange={(e) => setRule(c, { hours: Number(e.target.value) })} style={{ ...inputStyle, width: 80 }} /> h</>}
                  </span>
                </td>
              </tr>
            );
          })}
          <tr><td style={tdStyle}>Invalid number (reason)</td><td style={tdStyle}>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={v.invalid?.never !== false} onChange={(e) => setV({ ...v, invalid: { never: e.target.checked } })} /> Never retry (drop the lead)</label></td></tr>
          <tr><td style={tdStyle}>Drop after</td><td style={tdStyle}>
            <input type="number" min={1} max={50} value={v.max_attempts ?? 6} onChange={(e) => setV({ ...v, max_attempts: Number(e.target.value) })} style={{ ...inputStyle, width: 80 }} /> failed attempts · the owner can revive a Dropped lead</td></tr>
        </tbody>
      </table>
      <SaveRow onSave={() => save({ A: rule("A"), B: rule("B"), C: rule("C"), invalid: { never: v.invalid?.never !== false }, max_attempts: v.max_attempts ?? 6 })} saved={saved} err={err} />
    </section>
  );
}

function DigestSetting({ value, onSaved }: { value: any; onSaved: () => void }) {
  const [time, setTime] = useState(value?.send_time ?? "21:00");
  const [to, setTo] = useState((value?.recipients ?? []).join(", "));
  const { save, saved, err } = useSave("digest", onSaved);
  return (
    <Panel title="F digest email" sub="One email at the end of the day listing every paid trial">
      <div style={{ display: "grid", gap: 10 }}>
        <label><span style={labelStyle}>Send time (IST)</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, width: 140 }} /></label>
        <label><span style={labelStyle}>Recipients (empty = every owner)</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="owner@example.com" style={inputStyle} /></label>
      </div>
      <SaveRow onSave={() => save({ send_time: time, recipients: to.split(",").map((x: string) => x.trim()).filter(Boolean) })} saved={saved} err={err} />
    </Panel>
  );
}

function CallCheckSetting({ value, onSaved }: { value: any; onSaved: () => void }) {
  const [mode, setMode] = useState(value?.mode ?? "preview");
  const { save, saved, err } = useSave("call_check", onSaved);
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "16px 18px" }}>
      <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}><Title>Short-call auto-check</Title></h3>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: R.mute }}>Labels short calls (no answer, busy, switched off…) and flags codes that disagree. The prototype uses sample labels only; nothing is sent to a transcription service.</p>
      <div role="radiogroup" style={{ display: "grid", gap: 6, fontSize: 13.5 }}>
        <label><input type="radio" checked={mode === "preview"} onChange={() => setMode("preview")} /> Preview data only</label>
        <label><input type="radio" checked={mode === "off"} onChange={() => setMode("off")} /> Off</label>
        <label style={{ color: R.mute }}><input type="radio" disabled /> Live (Deepgram): needs client approval and cost sign-off</label>
      </div>
      <SaveRow onSave={() => save({ mode })} saved={saved} err={err} />
    </section>
  );
}

function TeamPermissions({ team, all, onSaved }: { team: NonNullable<Settings["team"]>; all: string[]; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = async (id: string, have: string[], p: string) => {
    setBusy(`${id}-${p}`);
    try {
      const next = have.includes(p) ? have.filter((x) => x !== p) : [...have, p];
      await api.put(`/crm/settings/team/${id}`, { permissions: next });
      onSaved();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel title="Team permissions" sub="Applies on the rep's next click: checked against the database on every request. The owner always has all of them.">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr><th style={thStyle}>Rep</th>{all.map((p) => <th key={p} style={{ ...thStyle, textAlign: "center", whiteSpace: "normal" }}>{PERMISSION_LABELS[p] ?? p}</th>)}</tr></thead>
          <tbody>{team.map((m) => (
            <tr key={m.id} className="crm-row">
              <td style={tdStyle}><span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><Avatar name={m.name} size={30} /><span><b>{m.name}</b><div style={{ fontSize: 11.5, color: R.mute }}>{m.email}</div></span></span></td>
              {all.map((p) => (
                <td key={p} style={{ ...tdStyle, textAlign: "center" }}>
                  <input type="checkbox" aria-label={`${m.name}: ${PERMISSION_LABELS[p]}`} checked={m.permissions.includes(p)} disabled={busy === `${m.id}-${p}`}
                    onChange={() => toggle(m.id, m.permissions, p)} style={{ width: 18, height: 18, accentColor: R.out, cursor: "pointer" }} />
                </td>
              ))}
            </tr>))}</tbody>
        </table>
      </div>
    </Panel>
  );
}
