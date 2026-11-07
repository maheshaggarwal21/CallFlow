"use client";

// CRM Settings (owner only): the status codes (add, rename, what each does), and which reps may export leads.
import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Avatar, Panel, R } from "@/components/report/kit";
import { api, fetcher } from "@/lib/api";
import { CODE_LETTERS, PERMISSION_LABELS, ROLE_LABEL, codeList, type Code, type CodeMeta, type CodeSetting, type Role } from "@/lib/crm";
import { useCrmMe } from "@/hooks/useCrmMe";
import { Btn, CRM_CSS, HeaderBand, inputStyle, tdStyle, thStyle } from "@/components/crm/kit";

type Settings = {
  values: Record<string, any>;
  team: { id: string; name: string; email: string; employee_code: number; permissions: string[] }[] | null;
};
/** The only permission still used by the simplified CRM. */
const SHOWN_PERMISSIONS = ["export_leads"];

export default function CrmSettingsPage() {
  const { data, error, mutate } = useSWR<Settings>("/crm/settings", fetcher);
  const { me } = useCrmMe();

  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gap: 14 }}>
      <style>{CRM_CSS}</style>
      <HeaderBand eyebrow="CRM" title="CRM Settings" sub="Statuses and who can export leads" />
      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p> : !data || !me ? <p style={{ color: R.mute }}>Loading…</p>
        : !me.is_owner ? <Panel title="Owner only"><p style={{ margin: 0, color: R.mute, fontSize: 13 }}>Only the owner can change CRM settings.</p></Panel>
        : <>
          <Statuses codes={data.values.codes} retry={data.values.retry_rules} onSaved={() => mutate()} />
          <TeamPermissions team={data.team ?? []} all={SHOWN_PERMISSIONS} onSaved={() => mutate()} />
        </>}
    </div>
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

/** The sheet's codes: the owner names each one, picks what saving it does, and can add new ones. */
function Statuses({ codes, retry, onSaved }: { codes: Record<Code, CodeSetting>; retry: any; onSaved: () => void }) {
  const [v, setV] = useState(() => codeList(codes));
  const free = CODE_LETTERS.filter((c) => !v.some((x) => x.code === c));
  const add = () => free[0] && setV([...v, { code: free[0], label: "", role: "callback", kind: "callback", rule: "" }]);
  const isNew = (c: string) => !codes?.[c];
  const [maxAttempts, setMaxAttempts] = useState<number>(retry?.max_attempts ?? 0);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t); }, [saved]);
  const set = (i: number, patch: Partial<CodeMeta>) => setV(v.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const save = async () => {
    setErr("");
    try {
      const body = Object.fromEntries(v.map((c) => [c.code, {
        label: c.label.trim() || `Code ${c.code}`, role: c.role,
        ...(c.role === "retry" ? (c.next_day_at ? { next_day_at: c.next_day_at } : { hours: c.hours ?? 3 }) : {}),
      }]));
      await api.patch("/crm/settings/values/codes", body);
      await api.patch("/crm/settings/values/retry_rules", { invalid: { never: retry?.invalid?.never !== false }, max_attempts: maxAttempts });
      setSaved(true);
      onSaved();
      globalMutate("/crm/config");
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "16px 18px" }}>
      <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>Statuses</h3>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: R.mute }}>
        The codes from the lead sheet. Name each one and choose what it does; add a new one with + Add status.
        "Not used" hides a code from the lead form. Changing what a code does also moves the leads already on it.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: 720 }}>
          <thead><tr><th style={thStyle}>Code</th><th style={thStyle}>Name</th><th style={thStyle}>What it does</th><th style={thStyle}>Next follow-up</th></tr></thead>
          <tbody>
            {v.map((c, i) => (
              <tr key={c.code}>
                <td style={{ ...tdStyle, fontWeight: 800, fontSize: 15 }}>
                  {isNew(c.code)
                    ? <select aria-label="Letter of the new status" value={c.code} onChange={(e) => set(i, { code: e.target.value })} style={{ ...inputStyle, width: 64, fontWeight: 800 }}>
                        {[c.code, ...free].sort().map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    : c.code}
                </td>
                <td style={tdStyle}><input aria-label={`Name of code ${c.code}`} value={c.label} maxLength={40} onChange={(e) => set(i, { label: e.target.value })} style={{ ...inputStyle, width: 190 }} /></td>
                <td style={tdStyle}>
                  <select aria-label={`What code ${c.code} does`} value={c.role} onChange={(e) => set(i, { role: e.target.value as Role })} style={{ ...inputStyle, width: 250 }}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td style={tdStyle}>
                  {c.role === "retry" ? (
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      <select aria-label={`Code ${c.code} follow-up`} value={c.next_day_at ? "next" : "hours"} onChange={(e) => set(i, e.target.value === "next" ? { next_day_at: "10:00", hours: undefined } : { hours: 3, next_day_at: undefined })} style={{ ...inputStyle, width: 130 }}>
                        <option value="hours">After hours</option><option value="next">Next day at</option>
                      </select>
                      {c.next_day_at ? <input type="time" aria-label={`Code ${c.code} next day time`} value={c.next_day_at} onChange={(e) => set(i, { next_day_at: e.target.value })} style={{ ...inputStyle, width: 110 }} />
                        : <><input type="number" aria-label={`Code ${c.code} hours`} min={0.25} max={168} step={0.25} value={c.hours ?? 3} onChange={(e) => set(i, { hours: Number(e.target.value) })} style={{ ...inputStyle, width: 74 }} /> h</>}
                    </span>
                  ) : <span style={{ color: R.mute, fontSize: 12.5 }}>{c.role === "callback" ? "Rep picks date and time" : "—"}</span>}
                  {isNew(c.code) && <button type="button" aria-label={`Remove new status ${c.code}`} onClick={() => setV(v.filter((_, j) => j !== i))}
                    style={{ marginLeft: 10, border: 0, background: "none", color: R.mute, cursor: "pointer", fontSize: 16 }}>×</button>}
                </td>
              </tr>
            ))}
            {free.length > 0 && <tr><td style={tdStyle} colSpan={4}>
              <Btn kind="ghost" onClick={add}>+ Add status</Btn></td></tr>}
            <tr><td style={tdStyle} colSpan={2}><b>Stop calling a lead</b></td><td style={tdStyle} colSpan={2}>
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <select aria-label="Stop calling a lead" value={maxAttempts > 0 ? "after" : "never"} onChange={(e) => setMaxAttempts(e.target.value === "never" ? 0 : 6)} style={{ ...inputStyle, width: 190 }}>
                  <option value="never">Never, keep calling</option><option value="after">After a number of tries</option>
                </select>
                {maxAttempts > 0 && <><input type="number" aria-label="Tries before stopping" min={1} max={50} value={maxAttempts} onChange={(e) => setMaxAttempts(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, width: 74 }} /> "no contact" calls in a row</>}
              </span></td></tr>
          </tbody>
        </table>
      </div>
      <SaveRow onSave={save} saved={saved} err={err} />
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
    <Panel title="Who can export leads" sub="The owner always can. Applies on the rep's next click.">
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
