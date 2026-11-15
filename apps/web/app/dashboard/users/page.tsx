"use client";

// Users (client's users.pdf, 12 Nov 2026): the list, and the "User Management System" form with
// Basic, Salary, Call Setting, Target and the Tabs checklist that decides which tabs a user sees.
import { useState, type CSSProperties, type ReactNode } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { C } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { EXTRA_PERMISSIONS, RANKS, TABS, rankLabel } from "@/lib/tabs";
import { Avatar, S } from "@/components/salary/kit";
import Tag from "@/components/ui/Tag";
import { Icon } from "@/components/crm/icons";
import ExtraCommissions, { extraProblem } from "@/components/users/ExtraCommissions";
import type { Employee, Intercom, Line, TeamsResponse, UserRole } from "@callflow/shared-types";

// Fits a 1280px laptop without sideways scrolling, Edit included (the minimums); on wider screens the spare
// room is shared out so Access, Status and Edit get space too, not just Designation. Email gets the most.
const COLS = "minmax(150px,1.3fr) 110px minmax(205px,1.35fr) 64px minmax(100px,0.8fr) minmax(104px,0.8fr) minmax(60px,0.6fr) minmax(36px,0.4fr)";
const TICKS = [...TABS.map((t) => ({ key: t.key, label: t.label })), ...EXTRA_PERMISSIONS];

/** The green on/off switch from the client's design. */
function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 46, height: 26, borderRadius: 13, border: "none", padding: 3, cursor: disabled ? "default" : "pointer", flexShrink: 0,
        background: on ? C.green : C.dim, opacity: disabled ? 0.5 : 1, transition: "background 0.15s", display: "flex", justifyContent: on ? "flex-end" : "flex-start" }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
    </button>
  );
}

export default function UsersPage() {
  const { data: all, isLoading, mutate } = useSWR<Employee[]>("/employees", fetcher);
  // active people on top, switched-off ones at the bottom (client, 14 Nov); sort() keeps the API order within each group
  const users = all && [...all].sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active"));
  const { id: myId } = useAuth();
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const [error, setError] = useState("");

  const setStatus = async (u: Employee, active: boolean) => {
    setError("");
    const to = active ? "active" : "inactive";
    // the switch moves at once; the server (about a second away) confirms, and the old state comes back if it refuses
    mutate((list) => list?.map((x) => (x.id === u.id ? { ...x, status: to } : x)), { revalidate: false });
    try {
      await api.patch(`/employees/${u.id}`, { status: to });
      if (!active) { globalMutate("/lines"); globalMutate("/intercoms"); } // their line and intercom were freed
    } catch (e) {
      setError((e as Error).message);
      mutate();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={S.h1}>Users</h1>
          <p style={S.sub}>Everyone who can sign in, what they see, and their salary, line and targets</p>
        </div>
        <button onClick={() => setEditing("new")} style={S.btnPrimary}><span style={{ fontSize: 17, lineHeight: 1 }}>+</span> Add User</button>
      </div>
      {error && <p role="alert" style={{ margin: 0, color: C.red, fontSize: 14 }}>{error}</p>}

      {isLoading ? <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p> : (
        <div style={{ ...S.card, overflowX: "auto" }}>
          <div style={{ minWidth: 940 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 16, padding: "0 20px", minHeight: 44,
              borderBottom: `2px solid ${C.border}`, background: C.bgDeep }}>
              {["Name", "Contact", "Email Id", "Reg No.", "Designation Name", "Access", "Status", "Edit"].map((h) => <span key={h} style={S.th}>{h}</span>)}
            </div>
            {(users ?? []).map((u, i) => (
              <div key={u.id} style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 16, padding: "14px 20px",
                borderBottom: i === users!.length - 1 ? "none" : `1px solid ${C.borderLight}`, opacity: u.status === "active" ? 1 : 0.6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <Avatar name={u.name} colorIndex={u.color_index} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: C.text, minWidth: 0, overflowWrap: "anywhere", lineHeight: 1.3 }}>{u.name}</span>
                </div>
                <span style={{ fontSize: 14, color: C.textSub, whiteSpace: "nowrap" }}>{u.phone || "—"}</span>
                <span style={{ fontSize: 14, color: C.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.email}>{u.email}</span>
                <span style={{ fontSize: 14, color: C.textSub }}>{u.employee_code}</span>
                <span style={{ fontSize: 14, color: C.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.designation ?? undefined}>{u.designation || "—"}</span>
                <span><Tag label={rankLabel(u.role)} color={u.role === "owner" ? C.orange : u.role === "admin" ? C.blue : C.textSub}
                  bg={u.role === "owner" ? C.orangeLight : u.role === "admin" ? C.blueLight : C.bgDeep} /></span>
                <Switch on={u.status === "active"} onChange={(v) => setStatus(u, v)} label={`${u.name} is active`} disabled={u.id === myId} />
                <button onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`} title="Edit"
                  style={{ ...S.btn, padding: 8, color: C.orange, justifySelf: "start" }}><Icon name="edit" size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && <UserForm user={editing === "new" ? null : editing} isSelf={editing !== "new" && editing.id === myId}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); mutate(); }} />}
    </div>
  );
}

const sectionTitle: CSSProperties = { margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.orange, textTransform: "uppercase", letterSpacing: 1,
  display: "flex", alignItems: "center", gap: 8 };
const fieldLabel: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: C.textSub, marginBottom: 5 };
const hint: CSSProperties = { fontWeight: 500, color: C.muted };
const input: CSSProperties = { ...S.input, background: C.card, fontSize: 14, boxShadow: "0 1px 2px rgba(60,40,20,0.04)" };

/** One part of the form on a soft card, so the white inputs stand out (client, 13 Nov: "looking a little dull"). */
function Section({ title, icon, right, children, style }: { title: string; icon: string; right?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: 14, padding: "16px 18px", minWidth: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <p style={sectionTitle}>
          <span aria-hidden style={{ width: 26, height: 26, borderRadius: 8, background: C.orangeLight, display: "inline-grid", placeItems: "center", fontSize: 14 }}>{icon}</span>
          {title}
        </p>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A target box with its round tick beside it (client's sketch, 15 Nov 2026): ticked = counts for the day's salary. */
function TargetRow({ on, onChange, label, children }: { on: boolean; onChange: (v: boolean) => void; label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "end" }}>
      {children}
      <button type="button" role="checkbox" aria-checked={on} aria-label={`${label} counts for daily salary`} title={on ? "Counts for daily salary" : "Doesn't count for daily salary"}
        onClick={() => onChange(!on)}
        style={{ width: 40, height: 40, borderRadius: "50%", cursor: "pointer", display: "grid", placeItems: "center", flex: "none", padding: 0,
          border: `3px solid ${on ? C.blue : C.border}`, background: on ? C.card : C.bgDeep, color: C.green, fontSize: 20, fontWeight: 900, lineHeight: 1 }}>
        {on ? "✓" : ""}
      </button>
    </div>
  );
}

function Field({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return <label style={{ display: "block", minWidth: 0 }}><span style={fieldLabel}>{label}{sub && <span style={hint}> · {sub}</span>}</span>{children}</label>;
}

const toHms = (secs: number) => [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60].map((n) => String(n).padStart(2, "0")).join(":");
/** "06:00:00" (or "6:00") → seconds; null when it isn't a time. */
const fromHms = (v: string) => {
  const p = v.trim().split(":").map(Number);
  if (p.length < 2 || p.length > 3 || p.some((n) => !Number.isInteger(n) || n < 0) || p[1] > 59 || (p[2] ?? 0) > 59) return null;
  return p[0] * 3600 + p[1] * 60 + (p[2] ?? 0);
};
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
const NEW_TEAM = "__new_team__";

function UserForm({ user, isSelf, onClose, onSaved }: { user: Employee | null; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const { isOwner, can } = useAuth();
  const { data: lines } = useSWR<Line[]>("/lines", fetcher);
  const { data: intercoms } = useSWR<Intercom[]>("/intercoms", fetcher);
  const { data: teamsData, mutate: reloadTeams } = useSWR<TeamsResponse>(can("teams") || can("users") ? "/teams" : null, fetcher);
  const [newTeam, setNewTeam] = useState<{ name: string; location: string; err: string; busy: boolean } | null>(null);
  const [f, setF] = useState({
    name: user?.name ?? "", phone: user?.phone ?? "", email: user?.email ?? "", employee_code: user ? String(user.employee_code) : "",
    designation: user?.designation ?? "", password: "", role: (user?.role ?? "employee") as UserRole, active: (user?.status ?? "active") === "active",
    fix_salary: String(user?.fix_salary ?? ""), trial_commission: String(user?.trial_commission ?? ""), trial_commission_type: user?.trial_commission_type ?? "fix",
    regular_commission: String(user?.regular_commission ?? ""), regular_commission_type: user?.regular_commission_type ?? "fix",
    duration: toHms(user?.target_call_secs ?? 0),
    target_trial: String(user?.target_trial ?? ""), target_regular: String(user?.target_regular ?? ""),
    // daily salary (15 Nov 2026): which targets count, and the first day paid (a new user: today, filled by the server)
    tick_call: user?.tick_call ?? false, tick_trial: user?.tick_trial ?? false, tick_regular: user?.tick_regular ?? false,
    join_date: user?.join_date ?? "",
    line_id: user?.line_id ?? "", intercom_id: user?.intercom_id ?? "", permissions: user?.permissions ?? [],
    extras: user?.extra_commissions ?? [], deductions: user?.extra_deductions ?? [], team_id: user?.team_id ?? "",
  });
  const [showPw, setShowPw] = useState(false);
  // "Show saved password" (client, 15 Nov 2026): the Super Admin reads a User's or Admin's password; nothing is logged
  const [savedPw, setSavedPw] = useState<{ status: string; password: string | null } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const showSaved = async () => {
    setPwBusy(true);
    try { setSavedPw(await api.get(`/employees/${user!.id}/password`)); } catch (e) { setError((e as Error).message); } finally { setPwBusy(false); }
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  // Line, intercom and calling number go together (one intercom per line, number = the intercom's):
  // picking the line brings its intercom; picking an intercom or number brings its line, and an
  // intercom not on any line yet is put on the picked line when the form is saved.
  const lineNo = (id: string) => (lines ?? []).find((l) => l.id === id)?.line_number;
  // one person per line, one intercom per line: only free ones are offered, plus what this user already has
  const lineChoices = (lines ?? []).filter((l) => !l.employee_id || l.employee_id === user?.id);
  const pickedLine = lineNo(f.line_id);
  const icChoices = (intercoms ?? []).filter((i) => !i.line_number || i.line_number === pickedLine || i.id === f.intercom_id);
  const intercom = (intercoms ?? []).find((i) => i.id === f.intercom_id);
  const pickLine = (id: string) => {
    const onIt = (intercoms ?? []).find((i) => i.line_number && i.line_number === lineNo(id));
    // a line with no intercom yet keeps an unattached intercom picked first (it goes on this line when saved)
    set({ line_id: id, intercom_id: onIt?.id ?? (intercom && !intercom.line_number ? intercom.id : "") });
  };
  const pickIntercom = (id: string) => {
    const ic = (intercoms ?? []).find((i) => i.id === id);
    const onLine = ic?.line_number ? (lines ?? []).find((l) => l.line_number === ic.line_number)?.id : undefined;
    set({ intercom_id: id, line_id: onLine ?? f.line_id });
  };

  // the small "Create team" popup: a name and the office address, then the new team is picked for this user
  const createTeam = async () => {
    if (!newTeam) return;
    if (!newTeam.name.trim()) return setNewTeam({ ...newTeam, err: "Give the team a name" });
    setNewTeam({ ...newTeam, err: "", busy: true });
    try {
      const t = await api.post<{ id: string }>("/teams", { name: newTeam.name.trim(), location: newTeam.location.trim() || null });
      await reloadTeams();
      globalMutate("/teams");
      set({ team_id: t.id });
      setNewTeam(null);
    } catch (e) {
      setNewTeam({ ...newTeam, err: (e as Error).message, busy: false });
    }
  };

  const all = f.role === "owner";
  const ticked = (k: string) => all || f.permissions.includes(k);
  const toggle = (k: string) => set({ permissions: ticked(k) ? f.permissions.filter((x) => x !== k) : [...f.permissions, k] });

  const save = async () => {
    setError("");
    const secs = fromHms(f.duration);
    if (!f.name.trim() || !f.email.trim()) return setError("Name and Email Id are needed.");
    if (!user && f.password.length < 8) return setError("Give the new user a password of at least 8 characters.");
    if (f.password && f.password.length < 8) return setError("The password needs at least 8 characters.");
    if (secs === null) return setError("Daily Calling Duration must be HH:MM:SS, for example 06:00:00.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setError("That Email Id doesn't look right.");
    if (f.phone.trim() && !/^\+?\d{8,14}$/.test(f.phone.replace(/[\s-]/g, ""))) return setError("Contact must be a phone number (8 to 15 digits).");
    if (f.employee_code.trim() && !(Number.isInteger(Number(f.employee_code)) && Number(f.employee_code) > 0)) return setError("Reg No. must be a whole number.");
    const nums = [f.fix_salary, f.trial_commission, f.regular_commission, f.target_trial, f.target_regular];
    if (nums.some((v) => v.trim() !== "" && !(Number(v) >= 0))) return setError("Salary and target figures can't be negative.");
    if ((f.trial_commission_type === "pct" && num(f.trial_commission) > 100) || (f.regular_commission_type === "pct" && num(f.regular_commission) > 100))
      return setError("A commission in % can't be more than 100.");
    if (f.intercom_id && !f.line_id) return setError("Pick a line for the intercom.");
    const bad = f.extras.map(extraProblem).findIndex(Boolean);
    if (bad >= 0) return setError(`Extra commission ${bad + 1}: ${extraProblem(f.extras[bad])}`);
    const badD = f.deductions.map(extraProblem).findIndex(Boolean);
    if (badD >= 0) return setError(`Extra deduction ${badD + 1}: ${extraProblem(f.deductions[badD])}`);
    const body = {
      name: f.name.trim(), email: f.email.trim(), phone: f.phone.replace(/[\s-]/g, "") || null, designation: f.designation.trim() || null,
      ...(f.employee_code.trim() ? { employee_code: Number(f.employee_code) } : {}),
      ...(f.password ? { password: f.password } : {}),
      // your own rank and status can't be changed by you, so they aren't sent
      ...(isSelf ? {} : { role: f.role, status: f.active ? "active" : "inactive" }),
      fix_salary: num(f.fix_salary), trial_commission: num(f.trial_commission), trial_commission_type: f.trial_commission_type,
      regular_commission: num(f.regular_commission), regular_commission_type: f.regular_commission_type,
      target_call_secs: secs, target_trial: num(f.target_trial), target_regular: num(f.target_regular),
      tick_call: f.tick_call, tick_trial: f.tick_trial, tick_regular: f.tick_regular,
      ...(f.join_date ? { join_date: f.join_date } : {}),
      permissions: all ? [] : f.permissions, line_id: f.line_id || null, intercom_id: f.intercom_id || null,
      extra_commissions: f.extras, extra_deductions: f.deductions,
      ...(teamsData ? { team_id: f.team_id || null } : {}),
    };
    setSaving(true);
    try {
      await (user ? api.patch(`/employees/${user.id}`, body) : api.post("/employees", body));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const rate = (label: string, key: "trial_commission" | "regular_commission") => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
      <Field label={label} sub="per student">
        <input type="number" min={0} value={f[key]} onChange={(e) => set({ [key]: e.target.value })} style={input} />
      </Field>
      <div role="radiogroup" aria-label={`${label} type`} style={{ display: "flex", gap: 14, paddingBottom: 9, fontSize: 14, color: C.text }}>
        {([["pct", "%"], ["fix", "Fix"]] as const).map(([v, text]) => (
          <label key={v} style={{ display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" name={key} checked={f[`${key}_type`] === v} onChange={() => set({ [`${key}_type`]: v })} style={{ accentColor: C.green, width: 16, height: 16 }} />{text}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(43,33,24,0.35)", zIndex: 200 }} />
      <div role="dialog" aria-label="User Management System" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 201,
        width: "min(1120px, calc(100vw - 32px))", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 20, boxShadow: "0 24px 60px -20px rgba(43,33,24,0.35)" }}>
        {/* Header: who this is, and the Active switch */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "20px 28px",
          background: C.orangeLight, borderBottom: `1px solid ${C.orangeBdr}`, borderRadius: "20px 20px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <Avatar name={f.name || "New user"} colorIndex={user?.color_index ?? 0} size={46} />
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>User Management System</h2>
              <p style={{ margin: "2px 0 0", fontSize: 13.5, color: C.textSub }}>{user ? `Edit ${user.name} · Reg No. ${user.employee_code}` : "Add a new user"}</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, fontWeight: 700, color: f.active ? C.green : C.muted,
            background: C.card, borderRadius: 999, padding: "6px 8px 6px 14px", border: `1px solid ${C.border}` }}>
            {f.active ? "Active" : "Inactive"}<Switch on={f.active} onChange={(v) => set({ active: v })} label="Active" disabled={isSelf} />
          </div>
        </div>

        <div style={{ display: "grid", gap: 16, padding: "20px 28px 24px" }}>
          <Section title="Basic" icon="👤">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
              <Field label="Name"><input value={f.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} style={input} /></Field>
              <Field label="Contact"><input value={f.phone} maxLength={15} inputMode="tel" onChange={(e) => set({ phone: e.target.value })} style={input} /></Field>
              <Field label="Email Id"><input type="email" value={f.email} maxLength={100} onChange={(e) => set({ email: e.target.value })} style={input} /></Field>
              <Field label="Reg No."><input type="number" min={1} value={f.employee_code} placeholder="Automatic" onChange={(e) => set({ employee_code: e.target.value })} style={input} /></Field>
              <Field label="Designation Name"><input value={f.designation} maxLength={60} placeholder="e.g. Call Rep." onChange={(e) => set({ designation: e.target.value })} style={input} /></Field>
              <div style={{ minWidth: 0 }}>
              <Field label="Password" sub={user ? "blank = no change" : "min 8 letters"}>
                <span style={{ position: "relative", display: "block" }}>
                  <input type={showPw ? "text" : "password"} value={f.password} maxLength={72} autoComplete="new-password"
                    onChange={(e) => set({ password: e.target.value })} style={{ ...input, paddingRight: 38 }} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}
                    style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: showPw ? C.orange : C.muted, display: "flex", padding: 4 }}>
                    <Icon name="eye" size={17} /></button>
                </span>
              </Field>
              {isOwner && user && (user.role !== "owner" || isSelf) && (
                <div style={{ marginTop: 6, fontSize: 12.5, color: C.textSub }}>
                  {!savedPw ? (
                    <button type="button" onClick={showSaved} disabled={pwBusy}
                      style={{ border: "none", background: "none", padding: 0, color: C.orange, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>{pwBusy ? "Loading…" : "Show saved password"}</button>
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {savedPw.status === "ok" ? <>Saved: <b style={{ fontFamily: "ui-monospace, monospace", fontSize: 13.5, color: C.text, userSelect: "all", overflowWrap: "anywhere" }}>{savedPw.password}</b>
                          <button type="button" onClick={() => navigator.clipboard?.writeText(savedPw.password ?? "")} style={{ border: "none", background: "none", padding: 0, color: C.orange, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Copy</button></>
                        : savedPw.status === "not_saved" ? "No saved copy yet. Type a new password above and Save to keep one here."
                        : "Viewing saved passwords isn't switched on yet."}
                      <button type="button" onClick={() => setSavedPw(null)} style={{ border: "none", background: "none", padding: 0, color: C.muted, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Hide</button>
                    </span>
                  )}
                </div>
              )}
              </div>
              {teamsData && (
                <Field label="Team">
                  <select value={f.team_id} onChange={(e) => (e.target.value === NEW_TEAM ? setNewTeam({ name: "", location: "", err: "", busy: false }) : set({ team_id: e.target.value }))} style={input}>
                    <option value="">— No team —</option>
                    {teamsData.teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.location ? ` · ${t.location}` : ""}</option>)}
                    <option value={NEW_TEAM}>+ Create team…</option>
                  </select>
                </Field>
              )}
              <Field label="Access rank">
                <select value={f.role} disabled={isSelf || (!isOwner && user?.role === "owner")} onChange={(e) => set({ role: e.target.value as UserRole })} style={input}>
                  {RANKS.filter((r) => isOwner || r.role !== "owner" || f.role === "owner").map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 16 }}>
            <Section title="Salary" icon="₹">
              <div style={{ display: "grid", gap: 12 }}>
                <Field label="Fix Salary" sub="in rupees, per month"><input type="number" min={0} value={f.fix_salary} onChange={(e) => set({ fix_salary: e.target.value })} style={input} /></Field>
                {rate("Trial Commission", "trial_commission")}
                {rate("Regular Commission", "regular_commission")}
              </div>
            </Section>

            <Section title="Call Setting" icon="☎">
              <div style={{ display: "grid", gap: 12 }}>
                <Field label="Line">
                  <select value={f.line_id} onChange={(e) => pickLine(e.target.value)} style={input}>
                    <option value="">— No line —</option>
                    {lineChoices.map((l) => <option key={l.id} value={l.id}>{l.line_number}</option>)}
                  </select>
                </Field>
                <Field label="Intercom">
                  <select value={f.intercom_id} onChange={(e) => pickIntercom(e.target.value)} style={input}>
                    <option value="">—</option>
                    {icChoices.map((i) => <option key={i.id} value={i.id}>{i.intercom_code}{i.line_number ? ` · line ${i.line_number}` : " · no line yet"}</option>)}
                  </select>
                </Field>
                <Field label="Calling Number">
                  <select value={intercom?.phone_number ? intercom.id : ""} onChange={(e) => pickIntercom(e.target.value)} style={input}>
                    <option value="">—</option>
                    {icChoices.filter((i) => i.phone_number).map((i) => <option key={i.id} value={i.id}>{i.phone_number}</option>)}
                  </select>
                </Field>
                <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>Pick any one and the others fill in. An intercom with no line yet goes on this line when you save.</p>
              </div>
            </Section>

            <Section title="Target" icon="◎">
              <div style={{ display: "grid", gap: 12 }}>
                <TargetRow on={f.tick_call} onChange={(v) => set({ tick_call: v })} label="Calling duration">
                  <Field label="Daily Calling Duration" sub="HH:MM:SS"><input value={f.duration} placeholder="06:00:00" onChange={(e) => set({ duration: e.target.value })} style={input} /></Field></TargetRow>
                <TargetRow on={f.tick_trial} onChange={(v) => set({ tick_trial: v })} label="Trial joining">
                  <Field label="Daily Trial Joining"><input type="number" min={0} value={f.target_trial} onChange={(e) => set({ target_trial: e.target.value })} style={input} /></Field></TargetRow>
                <TargetRow on={f.tick_regular} onChange={(v) => set({ tick_regular: v })} label="Regular joining">
                  <Field label="Daily Regular Joining" sub="new and renewals"><input type="number" min={0} value={f.target_regular} onChange={(e) => set({ target_regular: e.target.value })} style={input} /></Field></TargetRow>
                <Field label="Joining date" sub="first day paid">
                  <input type="date" value={f.join_date} onChange={(e) => set({ join_date: e.target.value })} style={input} /></Field>
                <p style={{ margin: 0, fontSize: 12, color: C.muted }}>✓ = counts for the daily salary. Ticked targets decide each working day&apos;s salary (each is an equal share: under 50 % ₹0, 50 % half, 75 % three quarters, 100 % full). None ticked: the full day.</p>
              </div>
            </Section>
          </div>

          <Section title="Extra Commission" icon="✦">
            <p style={{ margin: "-4px 0 12px", fontSize: 13, color: C.muted }}>A bonus amount on top of the salary and commission above, for a set time.</p>
            <ExtraCommissions value={f.extras} onChange={(extras) => set({ extras })} input={input} label={fieldLabel} />
          </Section>

          <Section title="Extra Deduction" icon="−">
            <p style={{ margin: "-4px 0 12px", fontSize: 13, color: C.muted }}>Cuts from the pay, a fixed amount or a % of the total pay (salary + commission + extras), for a set time.</p>
            <ExtraCommissions deduction value={f.deductions} onChange={(deductions) => set({ deductions })} input={input} label={fieldLabel} />
          </Section>

          <Section title="Tabs" icon="▦" right={!all && (
            <button type="button" onClick={() => set({ permissions: f.permissions.length === TICKS.length ? [] : TICKS.map((t) => t.key) })}
              style={{ border: "none", background: "none", color: C.orange, fontSize: 12, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", cursor: "pointer", marginBottom: 12 }}>
              {f.permissions.length === TICKS.length ? "Clear all" : "Select all"}</button>
          )}>
            <p style={{ margin: "-4px 0 12px", fontSize: 13, color: C.muted }}>
              {all ? "A Super Admin always sees every tab." : `${RANKS.find((r) => r.role === f.role)?.hint}. Tick the tabs this user should see in the left panel.`}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
              {TICKS.map((t) => (
                <label key={t.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", borderRadius: 10,
                  cursor: all ? "default" : "pointer", fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
                  border: `1px solid ${ticked(t.key) ? C.orangeBdr : C.border}`, background: ticked(t.key) ? C.orangeLight : C.card, color: ticked(t.key) ? C.orange : C.muted }}>
                  {t.label}
                  <input type="checkbox" checked={ticked(t.key)} disabled={all} onChange={() => toggle(t.key)} style={{ width: 17, height: 17, accentColor: C.orange }} />
                </label>
              ))}
            </div>
          </Section>
        </div>

        <div style={{ position: "sticky", bottom: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, flexWrap: "wrap",
          padding: "14px 28px", background: C.card, borderTop: `1px solid ${C.border}`, borderRadius: "0 0 20px 20px" }}>
          {error && <span role="alert" style={{ color: C.red, fontSize: 13.5, marginRight: "auto" }}>{error}</span>}
          <button onClick={onClose} style={S.btn}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...S.btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>

      {newTeam && (
        <>
          <div onClick={() => setNewTeam(null)} style={{ position: "fixed", inset: 0, background: "rgba(43,33,24,0.35)", zIndex: 300 }} />
          <div role="dialog" aria-label="Create team" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 301,
            width: "min(380px, calc(100vw - 32px))", background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: "24px 26px", boxShadow: "0 24px 60px -20px rgba(43,33,24,0.4)" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800, color: C.text }}>Create team</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: C.muted }}>It is picked for this user as soon as it is created.</p>
            <div style={{ display: "grid", gap: 12 }}>
              <Field label="Team name"><input autoFocus value={newTeam.name} maxLength={60} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && createTeam()} style={input} /></Field>
              <Field label="Office address"><input value={newTeam.location} maxLength={60} onChange={(e) => setNewTeam({ ...newTeam, location: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && createTeam()} style={input} /></Field>
            </div>
            {newTeam.err && <p role="alert" style={{ margin: "12px 0 0", fontSize: 13, color: C.red }}>{newTeam.err}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" onClick={() => setNewTeam(null)} style={S.btn}>Cancel</button>
              <button type="button" onClick={createTeam} disabled={newTeam.busy} style={{ ...S.btnPrimary, opacity: newTeam.busy ? 0.6 : 1 }}>{newTeam.busy ? "Creating…" : "Create"}</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
