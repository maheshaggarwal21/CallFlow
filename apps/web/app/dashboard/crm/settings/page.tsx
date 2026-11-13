"use client";

// CRM Settings: the status codes — name each one and pick its colour (client, 12 Nov 2026).
// What a code does and the follow-up rules are no longer shown here; each code keeps the behaviour it has.
// Who may open the CRM tabs is ticked on the Users tab.
import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { R } from "@/components/report/kit";
import { api, fetcher } from "@/lib/api";
import { CODE_LETTERS, codeList, type Code, type CodeMeta, type CodeSetting } from "@/lib/crm";
import { useCrmMe } from "@/hooks/useCrmMe";
import ColorPalette from "@/components/crm/ColorPalette";
import { Btn, CRM_CSS, HeaderBand, NoAccess, inputStyle, tdStyle, thStyle } from "@/components/crm/kit";

type Settings = { values: Record<string, any> };

export default function CrmSettingsPage() {
  const { me, can } = useCrmMe();
  const allowed = !!me && can("crm_settings");
  const { data, error, mutate } = useSWR<Settings>(allowed ? "/crm/settings" : null, fetcher);
  if (me && !allowed) return <NoAccess what="CRM Settings" />;

  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gap: 14 }}>
      <style>{CRM_CSS}</style>
      <HeaderBand eyebrow="CRM" title="CRM Settings" sub="Status codes and their colours" />
      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p> : !data || !me ? <p style={{ color: R.mute }}>Loading…</p>
        : <Statuses codes={data.values.codes} onSaved={() => mutate()} />}
    </div>
  );
}

/** The sheet's codes: the owner names each one, picks its colour, and can add new ones. */
function Statuses({ codes, onSaved }: { codes: Record<Code, CodeSetting>; onSaved: () => void }) {
  const [v, setV] = useState(() => codeList(codes));
  const free = CODE_LETTERS.filter((c) => !v.some((x) => x.code === c));
  // shortcut: a new code is saved as "other" (no automatic follow-up, the rep may set one), since
  // "what it does" is no longer asked; bring the choice back if new codes need other behaviour.
  const add = () => free[0] && setV([...v, { code: free[0], label: "", role: "other", kind: "other", rule: "" }]);
  const isNew = (c: string) => !codes?.[c];
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t); }, [saved]);
  const set = (i: number, patch: Partial<CodeMeta>) => setV(v.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const save = async () => {
    setErr("");
    try {
      // each code keeps the behaviour it already has; only its name and colour change here
      const body = Object.fromEntries(v.map(({ code, kind, rule, ...c }) => {
        const label = c.label.trim() || `Code ${code}`;
        return [code, { ...c, label, color: c.color || undefined, ...(c.role === "other" ? { description: c.description?.trim() || label } : {}) }];
      }));
      await api.patch("/crm/settings/values/codes", body);
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
        The codes from the lead sheet. Name each one and pick its colour from the Palette: the code is shown in that colour on the Leads tab. Add a new one with + Add status.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr><th style={thStyle}>Code</th><th style={thStyle}>Name</th><th style={thStyle}>Colour</th></tr></thead>
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
                <td style={tdStyle}><input aria-label={`Name of code ${c.code}`} value={c.label} maxLength={40} onChange={(e) => set(i, { label: e.target.value })} style={{ ...inputStyle, width: 220 }} /></td>
                <td style={tdStyle}>
                  <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                    <ColorPalette code={c.code} value={c.color} onSelect={(color) => set(i, { color })} />
                    {isNew(c.code) && <button type="button" aria-label={`Remove new status ${c.code}`} onClick={() => setV(v.filter((_, j) => j !== i))}
                      style={{ border: 0, background: "none", color: R.mute, cursor: "pointer", fontSize: 16 }}>×</button>}
                  </span>
                </td>
              </tr>
            ))}
            {free.length > 0 && <tr><td style={tdStyle} colSpan={3}><Btn kind="ghost" onClick={add}>+ Add status</Btn></td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <Btn onClick={save}>Save</Btn>
        {saved && <span role="status" style={{ color: R.good, fontSize: 13, fontWeight: 600 }}>Saved ✓</span>}
        {err && <span role="alert" style={{ color: R.bad, fontSize: 13 }}>{err}</span>}
      </div>
    </section>
  );
}
