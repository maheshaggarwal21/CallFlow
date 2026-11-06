"use client";

// CRM Settings, kept to two things (client, 7 Nov): when a "no contact" lead comes back for a
// follow-up, and which reps may export leads. Owner only.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Avatar, Panel, R } from "@/components/report/kit";
import { api, fetcher } from "@/lib/api";
import { CODES, PERMISSION_LABELS } from "@/lib/crm";
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
      <HeaderBand eyebrow="CRM" title="CRM Settings" sub="Follow-up rules and who can export leads" />
      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p> : !data || !me ? <p style={{ color: R.mute }}>Loading…</p>
        : !me.is_owner ? <Panel title="Owner only"><p style={{ margin: 0, color: R.mute, fontSize: 13 }}>Only the owner can change CRM settings.</p></Panel>
        : <>
          <RetryRules value={data.values.retry_rules} onSaved={() => mutate()} />
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

function RetryRules({ value, onSaved }: { value: any; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const { save, saved, err } = useSave("retry_rules", onSaved);
  const rule = (c: "A" | "B" | "C") => v[c] ?? {};
  const setRule = (c: "A" | "B" | "C", r: object) => setV({ ...v, [c]: r });
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "16px 18px" }}>
      <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>Follow-up rules</h3>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: R.mute }}>When a lead comes back for a follow-up after a call with no contact. The rep can still change the time in the form.</p>
      <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: 480 }}>
        <thead><tr><th style={thStyle}>Status</th><th style={thStyle}>Follow up</th></tr></thead>
        <tbody>
          {(["B", "C", "A"] as const).map((c) => {
            const r = rule(c), nextDay = !!r.next_day_at;
            return (
              <tr key={c}>
                <td style={tdStyle}>{CODES.find((x) => x.code === c)?.label}</td>
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
          <tr><td style={tdStyle}>Drop after</td><td style={tdStyle}>
            <input type="number" min={1} max={50} value={v.max_attempts ?? 6} onChange={(e) => setV({ ...v, max_attempts: Number(e.target.value) })} style={{ ...inputStyle, width: 80 }} /> calls with no contact in a row</td></tr>
        </tbody>
      </table>
      <SaveRow onSave={() => save({ A: rule("A"), B: rule("B"), C: rule("C"), invalid: { never: v.invalid?.never !== false }, max_attempts: v.max_attempts ?? 6 })} saved={saved} err={err} />
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
