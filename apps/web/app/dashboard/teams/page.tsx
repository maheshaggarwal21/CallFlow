"use client";

// Teams (client, 13 Nov 2026): the owner runs offices in two or more places. One card per team with
// its agents and today's numbers, a "Today's race" bar comparing the offices, and the agents not in
// a team yet. Agents move between teams with a dropdown (the client prefers dropdowns to dragging).
import { useState, type CSSProperties } from "react";
import useSWR from "swr";
import { C, eClr } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import { Avatar, S } from "@/components/salary/kit";
import Tag from "@/components/ui/Tag";
import type { Team, TeamAgent, TeamsResponse } from "@callflow/shared-types";

const hm = (secs: number) => (secs < 3600 ? `${Math.round(secs / 60)}m` : `${Math.floor(secs / 3600)}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}m`);
const sum = (a: TeamAgent[], f: (x: TeamAgent) => number) => a.reduce((t, x) => t + f(x), 0);
const input: CSSProperties = { ...S.input, background: C.card, fontSize: 14 };
const smallBtn = (color: string): CSSProperties => ({ border: "none", background: "none", color, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "4px 6px" });

export default function TeamsPage() {
  const { data, error, mutate } = useSWR<TeamsResponse>("/teams", fetcher);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  const run = async (p: Promise<unknown>) => {
    setErr("");
    try { await p; await mutate(); return true; } catch (e) { setErr((e as Error).message); return false; }
  };
  const move = (agent: TeamAgent, teamId: string) => run(api.put(`/teams/members/${agent.id}`, { team_id: teamId || null }));

  if (error) return <p role="alert" style={{ color: C.red }}>{(error as Error).message}</p>;
  if (!data) return <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>;
  const { teams, unassigned } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={S.h1}>Teams</h1>
          <p style={S.sub}>Your offices and the agents in each</p>
        </div>
        {!adding && <button onClick={() => setAdding(true)} style={S.btnPrimary}><span style={{ fontSize: 17, lineHeight: 1 }}>+</span> New team</button>}
      </div>
      {err && <p role="alert" style={{ margin: 0, color: C.red, fontSize: 14 }}>{err}</p>}

      {adding && <TeamForm onCancel={() => setAdding(false)} onSave={async (v) => { if (await run(api.post("/teams", v))) setAdding(false); }} />}

      {teams.length > 1 && <Race teams={teams} />}

      {teams.length === 0 && !adding && (
        <div style={{ ...S.card, padding: "28px 24px", textAlign: "center", color: C.muted, fontSize: 14 }}>
          No teams yet. Press <b style={{ color: C.orange }}>+ New team</b> to add one for each office.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 18, alignItems: "start" }}>
        {teams.map((t) => <TeamCard key={t.id} team={t} teams={teams} onMove={move} run={run} />)}
      </div>

      {unassigned.length > 0 && (
        <section style={{ ...S.card, border: `1px dashed ${C.border}`, boxShadow: "none", padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.text }}>Not in a team yet</h2>
            <Tag label={String(unassigned.length)} color={C.textSub} bg={C.bgDeep} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: "0 24px" }}>
            {unassigned.map((a) => <AgentRow key={a.id} agent={a} teams={teams} onMove={move} placeholder="Add to team…" />)}
          </div>
        </section>
      )}
    </div>
  );
}

/** Each office's share of today's calls, side by side. */
function Race({ teams }: { teams: Team[] }) {
  const calls = teams.map((t) => sum(t.members, (m) => m.calls_today));
  const total = calls.reduce((a, b) => a + b, 0);
  return (
    <section style={{ ...S.card, padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text }}>Today&apos;s race</h2>
        <span style={{ fontSize: 13, color: C.muted }}>{total ? `${total} calls today across ${teams.length} offices` : "No calls yet today"}</span>
      </div>
      <div style={{ display: "flex", height: 34, borderRadius: 10, overflow: "hidden", background: C.bgDeep }}>
        {total > 0 && teams.map((t, i) => calls[i] > 0 && (
          <div key={t.id} title={`${t.name}: ${calls[i]} calls`} style={{ width: `${(calls[i] / total) * 100}%`, background: eClr(t.color_index).t, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800, minWidth: 40, whiteSpace: "nowrap", overflow: "hidden" }}>
            {Math.round((calls[i] / total) * 100)}%
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10 }}>
        {teams.map((t, i) => (
          <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: C.textSub }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: eClr(t.color_index).t }} /><b style={{ color: C.text }}>{t.name}</b> {calls[i]} calls
          </span>
        ))}
      </div>
    </section>
  );
}

function TeamCard({ team, teams, onMove, run }: {
  team: Team; teams: Team[]; onMove: (a: TeamAgent, teamId: string) => void; run: (p: Promise<unknown>) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const clr = eClr(team.color_index);
  const calls = sum(team.members, (m) => m.calls_today), talk = sum(team.members, (m) => m.talk_secs_today);
  const best = [...team.members].sort((a, b) => b.calls_today - a.calls_today)[0];
  return (
    <section style={{ ...S.card, overflow: "hidden" }}>
      <div style={{ height: 6, background: clr.t }} />
      <div style={{ padding: "16px 20px 6px" }}>
        {mode === "edit" ? (
          <TeamForm initial={team} onCancel={() => setMode("view")} onSave={async (v) => { if (await run(api.patch(`/teams/${team.id}`, v))) setMode("view"); }} />
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <span aria-hidden style={{ width: 44, height: 44, borderRadius: 12, background: clr.bg, border: `1px solid ${clr.br}`, color: clr.t,
                display: "grid", placeItems: "center", fontSize: 18, fontWeight: 800, flex: "none" }}>{team.name.trim().slice(0, 1).toUpperCase()}</span>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: C.text }}>{team.name}</h2>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>📍 {team.location || "Location not set"}</div>
              </div>
            </div>
            {mode === "delete" ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: C.textSub }}>
                Delete? Agents stay, without a team.
                <button onClick={() => run(api.delete(`/teams/${team.id}`))} style={smallBtn(C.red)}>Yes</button>
                <button onClick={() => setMode("view")} style={smallBtn(C.textSub)}>No</button>
              </span>
            ) : (
              <span style={{ display: "inline-flex", flex: "none" }}>
                <button onClick={() => setMode("edit")} style={smallBtn(C.orange)}>Rename</button>
                <button onClick={() => setMode("delete")} style={smallBtn(C.muted)}>Delete</button>
              </span>
            )}
          </div>
        )}

        {/* today's numbers for the office */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, margin: "14px 0 10px" }}>
          {[["Agents", String(team.members.length)], ["Calls today", String(calls)], ["Talk time", hm(talk)]].map(([label, value]) => (
            <div key={label} style={{ background: clr.bg, borderRadius: 10, padding: "9px 12px" }}>
              <div style={{ ...S.label, fontSize: 10.5, color: clr.t }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 20px 12px" }}>
        {team.members.length === 0
          ? <p style={{ margin: "4px 0 10px", padding: "16px", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 10, color: C.muted, fontSize: 13.5 }}>
              No agents yet. Move someone here with the dropdown next to their name.</p>
          : team.members.map((a) => (
              <AgentRow key={a.id} agent={a} teams={teams} onMove={onMove} placeholder="Move to…" star={!!best && best.calls_today > 0 && a.id === best.id} />
            ))}
      </div>
    </section>
  );
}

function AgentRow({ agent, teams, onMove, placeholder, star }: {
  agent: TeamAgent; teams: Team[]; onMove: (a: TeamAgent, teamId: string) => void; placeholder: string; star?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.borderLight}` }}>
      <Avatar name={agent.name} colorIndex={agent.color_index} size={36} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14.5, fontWeight: 700, color: C.text }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</span>
          {star && <Tag label="★ Top today" color={C.orange} bg={C.orangeLight} style={{ fontSize: 10.5, padding: "2px 8px" }} />}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted }}>{agent.designation || "Agent"} · Reg No. {agent.employee_code}</div>
      </div>
      <span title="Calls today" style={{ fontSize: 13, fontWeight: 700, color: agent.calls_today ? C.text : C.dim, whiteSpace: "nowrap" }}>{agent.calls_today} calls</span>
      <select aria-label={`Team for ${agent.name}`} value="" onChange={(e) => e.target.value && onMove(agent, e.target.value === "none" ? "" : e.target.value)}
        style={{ ...input, width: 128, padding: "6px 8px", fontSize: 12.5 }}>
        <option value="">{placeholder}</option>
        {teams.filter((t) => t.id !== agent.team_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        {agent.team_id && <option value="none">No team</option>}
      </select>
    </div>
  );
}

function TeamForm({ initial, onSave, onCancel }: { initial?: Team; onSave: (v: { name: string; location: string | null }) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [err, setErr] = useState("");
  const save = () => {
    if (!name.trim()) return setErr("Give the team a name.");
    onSave({ name: name.trim(), location: location.trim() || null });
  };
  return (
    <div style={{ ...(initial ? {} : { ...S.card, padding: "16px 20px" }), display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
      <label style={{ flex: "1 1 180px" }}><span style={{ ...S.label, display: "block", marginBottom: 6 }}>Team name</span>
        <input autoFocus value={name} maxLength={60} placeholder="e.g. Team A" onChange={(e) => { setErr(""); setName(e.target.value); }} style={input} /></label>
      <label style={{ flex: "1 1 180px" }}><span style={{ ...S.label, display: "block", marginBottom: 6 }}>Office location</span>
        <input value={location} maxLength={60} placeholder="e.g. Chandigarh" onChange={(e) => setLocation(e.target.value)} style={input} /></label>
      <span style={{ display: "inline-flex", gap: 8 }}>
        <button onClick={onCancel} style={S.btn}>Cancel</button>
        <button onClick={save} style={{ ...S.btnPrimary, padding: "9px 18px" }}>{initial ? "Save" : "Create team"}</button>
      </span>
      {err && <span role="alert" style={{ width: "100%", color: C.red, fontSize: 13 }}>{err}</span>}
    </div>
  );
}
