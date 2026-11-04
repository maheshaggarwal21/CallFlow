"use client";

import { useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import useSWR from "swr";
import { C } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/datetime";
import Card from "@/components/ui/Card";
import type {
  EmployeeName,
  ReportFrequency,
  ReportPreview,
  ReportRun,
  ReportSchedule,
  ReportScheduleInput,
} from "@callflow/shared-types";

const DEFAULT_SUBJECT = "{{report_type}} Report — {{name}} — {{period}}";

const DEFAULT_BODY = `Representative {{report_type}} Report
{{period}}

Name: {{name}}
Employee Id: {{employee_id}}
Line: {{lines}}

Total Calls: {{total_calls}} (Inbound {{inbound}} / Outbound {{outbound}})
Total Duration: {{total_duration}} (HH:MM:SS)
Average Duration: {{avg_duration}}
Calls less than 10 seconds: {{calls_under_10s}}
Minimum gap between calls: {{min_gap}}
Maximum gap between calls: {{max_gap}}

Invalid Numbers Dialled: {{invalid_numbers}}
(Valid: 0 + 10 digits, 91 + 10 digits, or a 10-digit mobile starting 6–9)

Numbers by length (Inbound / Outbound)
10 digits: {{d10_in}} / {{d10_out}}
11 digits: {{d11_in}} / {{d11_out}}
12 digits: {{d12_in}} / {{d12_out}}
Other lengths: {{dother_in}} / {{dother_out}}

Calls less than 30 seconds: {{b_lt_30s}}
30 seconds to 60 seconds: {{b_30_60s}}
1 min to 2 min: {{b_1_2m}}
2 min to 3 min: {{b_2_3m}}
3 min to 5 min: {{b_3_5m}}
5 min to 10 min: {{b_5_10m}}
10 min to 15 min: {{b_10_15m}}
More than 15 min: {{b_gt_15m}}`;

// Mirrors the variables built by the API's report.service.ts: [variable, button label]
const VARIABLES: [string, string][] = [
  ["name", "Name"], ["employee_id", "Employee Id"], ["lines", "Line"],
  ["report_type", "Daily/Weekly/Monthly"], ["period", "Date / period"],
  ["total_calls", "Total calls"], ["inbound", "Inbound calls"], ["outbound", "Outbound calls"],
  ["total_duration", "Total duration"], ["avg_duration", "Average duration"],
  ["calls_under_10s", "Calls < 10 s"], ["min_gap", "Minimum gap"], ["max_gap", "Maximum gap"],
  ["invalid_numbers", "Invalid numbers dialled"], ["invalid_inbound", "Invalid inbound numbers"],
  ["d10_in", "10-digit inbound"], ["d10_out", "10-digit outbound"],
  ["d11_in", "11-digit inbound"], ["d11_out", "11-digit outbound"],
  ["d12_in", "12-digit inbound"], ["d12_out", "12-digit outbound"],
  ["dother_in", "Other-length inbound"], ["dother_out", "Other-length outbound"],
  ["no_number", "No number recorded"],
  ["b_lt_30s", "< 30 s"], ["b_30_60s", "30–60 s"], ["b_1_2m", "1–2 min"], ["b_2_3m", "2–3 min"],
  ["b_3_5m", "3–5 min"], ["b_5_10m", "5–10 min"], ["b_10_15m", "10–15 min"], ["b_gt_15m", "> 15 min"],
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FREQ_LABEL: Record<ReportFrequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same `{{var}}` rule as the server, so the preview matches the mail. */
const render = (t: string, vars: Record<string, string>) =>
  t.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));

const parseEmails = (s: string) => s.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);

const fieldLabel: CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 700, color: C.muted,
  textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6,
};
const fieldInput: CSSProperties = {
  width: "100%", padding: "10px 12px", boxSizing: "border-box",
  background: C.bgDeep, border: `1px solid ${C.border}`,
  borderRadius: 10, fontSize: 13, color: C.text, outline: "none",
};
const btn = (primary = false): CSSProperties => ({
  padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
  border: `1px solid ${primary ? C.orange : C.border}`,
  background: primary ? C.orange : C.card, color: primary ? "#fff" : C.textSub,
});
const chip = (on: boolean): CSSProperties => ({
  padding: "6px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer",
  border: `1px solid ${on ? C.orange : C.border}`,
  background: on ? C.orangeLight : C.card, color: on ? C.orange : C.textSub,
});

export default function ReportsPage() {
  const { data: employees = [] } = useSWR<EmployeeName[]>("/employees/names", fetcher);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Reports</h1>
        <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted }}>
          Email each employee&apos;s call report on a schedule, or view it here
        </p>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <span style={chip(true)}>Email schedules</span>
        {/* The report itself is its own dashboard: Overview, Team and a page per person */}
        <Link href="/dashboard/reports/view" style={{ ...chip(false), textDecoration: "none" }}>View report →</Link>
      </div>

      <SchedulesTab employees={employees} />
    </div>
  );
}

// ── Schedules ────────────────────────────────────────────────────────────────

function SchedulesTab({ employees }: { employees: EmployeeName[] }) {
  const { data: schedules, mutate } = useSWR<ReportSchedule[]>("/reports/schedules", fetcher);
  const { data: runs, mutate: mutateRuns } = useSWR<ReportRun[]>("/reports/runs?limit=30", fetcher);
  const [editing, setEditing] = useState<ReportSchedule | "new" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const empName = (id: string) => employees.find((e) => e.id === id)?.name ?? "Inactive employee";

  async function act(id: string, fn: () => Promise<string>) {
    setBusy(id);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await fn() });
      await Promise.all([mutate(), mutateRuns()]);
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const sendNow = (s: ReportSchedule) => act(s.id, async () => {
    const { results } = await api.post<{ results: { status: string; error?: string }[] }>(
      `/reports/schedules/${s.id}/send-now`
    );
    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed");
    if (!results.length) throw new Error("No active employees in this schedule.");
    if (failed.length) throw new Error(`Sent ${sent}, failed ${failed.length}: ${failed[0].error}`);
    return `Sent ${sent} email${sent === 1 ? "" : "s"} to ${s.recipients.join(", ")}.`;
  });

  const toggle = (s: ReportSchedule) => act(s.id, async () => {
    const { id, created_at, updated_at, ...input } = s;
    await api.patch(`/reports/schedules/${id}`, { ...input, is_active: !s.is_active });
    return s.is_active ? `Paused "${s.name}".` : `Resumed "${s.name}".`;
  });

  const remove = (s: ReportSchedule) => {
    if (!window.confirm(`Delete the schedule "${s.name}"? Its send history is deleted too.`)) return;
    act(s.id, async () => {
      await api.delete(`/reports/schedules/${s.id}`);
      return `Deleted "${s.name}".`;
    });
  };

  if (editing) {
    return (
      <ScheduleForm
        employees={employees}
        initial={editing === "new" ? null : editing}
        onDone={async (text) => {
          setEditing(null);
          if (text) setMessage({ ok: true, text });
          await mutate();
        }}
      />
    );
  }

  return (
    <>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Email schedules</h2>
          <button onClick={() => setEditing("new")} style={btn(true)}>+ New schedule</button>
        </div>

        {message && (
          <p role="status" style={{ margin: "14px 0 0", fontSize: 13, fontWeight: 600, color: message.ok ? C.green : C.red }}>
            {message.text}
          </p>
        )}

        {!schedules ? (
          <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>
        ) : schedules.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 14, margin: "16px 0 0" }}>
            No schedules yet. Create one to email reports automatically.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {schedules.map((s) => (
              <div key={s.id} style={{
                border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 18px",
                display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center",
                opacity: busy === s.id ? 0.6 : 1,
              }}>
                <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{s.name}</span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
                      textTransform: "uppercase", letterSpacing: 0.6,
                      background: s.is_active ? C.greenLight : C.bgDeep,
                      color: s.is_active ? C.green : C.muted,
                      border: `1px solid ${s.is_active ? C.greenBdr : C.border}`,
                    }}>{s.is_active ? "Active" : "Paused"}</span>
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: C.textSub }}>
                    {FREQ_LABEL[s.frequency]} at {s.send_time} IST
                    {s.frequency === "weekly" && s.weekday != null && ` on ${WEEKDAYS[s.weekday]}`}
                    {s.frequency === "monthly" && " on the last day of the month"}
                    {" · "}{s.combine_employees ? "one combined email" : "one email per employee"}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: C.muted }}>
                    {s.employee_ids.map(empName).join(", ")} → {s.recipients.join(", ")}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button disabled={busy !== null} onClick={() => sendNow(s)} style={btn(true)}>Send now</button>
                  <button disabled={busy !== null} onClick={() => setEditing(s)} style={btn()}>Edit</button>
                  <button disabled={busy !== null} onClick={() => toggle(s)} style={btn()}>
                    {s.is_active ? "Pause" : "Resume"}
                  </button>
                  <button disabled={busy !== null} onClick={() => remove(s)} style={{ ...btn(), color: C.red }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 700, color: C.text }}>Recent sends</h2>
        {!runs?.length ? (
          <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>Nothing sent yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: C.muted }}>
                  {["When", "Schedule", "Employee", "Status"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: C.textSub }}>
                      {fmtDate(r.created_at)}, {fmtTime(r.created_at)}
                      {r.period_key.startsWith("manual:") && <span style={{ color: C.muted }}> · test</span>}
                    </td>
                    <td style={{ padding: "8px 10px", color: C.text }}>{r.schedule_name}</td>
                    <td style={{ padding: "8px 10px", color: C.text }}>{r.employee_name}</td>
                    <td style={{ padding: "8px 10px", color: r.status === "sent" ? C.green : r.status === "failed" ? C.red : C.muted }}>
                      {r.status === "sent" ? "Sent" : r.status === "failed" ? `Failed (try ${r.attempts}/3): ${r.error ?? ""}` : "Sending…"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function ScheduleForm({ employees, initial, onDone }: {
  employees: EmployeeName[];
  initial: ReportSchedule | null;
  onDone: (message?: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "Daily employee report");
  const [employeeIds, setEmployeeIds] = useState<string[]>(initial?.employee_ids ?? []);
  const [frequency, setFrequency] = useState<ReportFrequency>(initial?.frequency ?? "daily");
  const [sendTime, setSendTime] = useState(initial?.send_time ?? "19:00");
  const [weekday, setWeekday] = useState<number>(initial?.weekday ?? 6);
  const [emails, setEmails] = useState(initial?.recipients.join(", ") ?? "");
  const [combine, setCombine] = useState(initial?.combine_employees ?? false);
  const [subject, setSubject] = useState(initial?.subject_template ?? DEFAULT_SUBJECT);
  const [body, setBody] = useState(initial?.body_template ?? DEFAULT_BODY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const recipients = parseEmails(emails);
  const badEmails = recipients.filter((e) => !EMAIL_RE.test(e));
  const previewId = employeeIds[0];
  const { data: preview } = useSWR<ReportPreview>(
    previewId ? `/reports/preview?employee_id=${previewId}&frequency=${frequency}` : null,
    fetcher
  );

  const toggleEmployee = (id: string) =>
    setEmployeeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  function insertVariable(v: string) {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) return setBody((b) => b + token);
    const { selectionStart: a, selectionEnd: b } = el;
    setBody(body.slice(0, a) + token + body.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  }

  async function save() {
    if (!employeeIds.length) return setError("Pick at least one employee.");
    if (!recipients.length) return setError("Add at least one email address.");
    if (badEmails.length) return setError(`Not a valid email: ${badEmails.join(", ")}`);
    setSaving(true);
    setError(null);
    const input: ReportScheduleInput = {
      name: name.trim() || "Employee report",
      employee_ids: employeeIds,
      frequency,
      send_time: sendTime,
      weekday: frequency === "weekly" ? weekday : null,
      recipients,
      subject_template: subject,
      body_template: body,
      combine_employees: combine,
      is_active: initial?.is_active ?? true,
    };
    try {
      if (initial) await api.patch(`/reports/schedules/${initial.id}`, input);
      else await api.post("/reports/schedules", input);
      onDone(initial ? `Saved "${input.name}".` : `Created "${input.name}". Use Send now to test it.`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700, color: C.text }}>
        {initial ? "Edit schedule" : "New schedule"}
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <label htmlFor="rs-name" style={fieldLabel}>Schedule name</label>
          <input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} style={fieldInput} maxLength={100} />
        </div>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={fieldLabel}>Employees</legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={chip(employees.length > 0 && employeeIds.length === employees.length)}
              onClick={() => setEmployeeIds(employeeIds.length === employees.length ? [] : employees.map((e) => e.id))}>
              All active
            </button>
            {employees.map((e) => (
              <button key={e.id} type="button" aria-pressed={employeeIds.includes(e.id)}
                style={chip(employeeIds.includes(e.id))} onClick={() => toggleEmployee(e.id)}>
                {e.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={fieldLabel}>How to send</legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" aria-pressed={!combine} style={chip(!combine)} onClick={() => setCombine(false)}>
              One email per employee
            </button>
            <button type="button" aria-pressed={combine} style={chip(combine)} onClick={() => setCombine(true)}>
              All employees in one email
            </button>
          </div>
        </fieldset>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 160px" }}>
            <label htmlFor="rs-freq" style={fieldLabel}>Frequency</label>
            <select id="rs-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as ReportFrequency)} style={fieldInput}>
              <option value="daily">Daily (today so far)</option>
              <option value="weekly">Weekly (last 7 days)</option>
              <option value="monthly">Monthly (last day of month)</option>
            </select>
          </div>
          {frequency === "weekly" && (
            <div style={{ flex: "1 1 160px" }}>
              <label htmlFor="rs-day" style={fieldLabel}>Day</label>
              <select id="rs-day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={fieldInput}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: "1 1 160px" }}>
            <label htmlFor="rs-time" style={fieldLabel}>Send time (IST)</label>
            <input id="rs-time" type="time" value={sendTime} required
              onChange={(e) => setSendTime(e.target.value)} style={fieldInput} />
          </div>
        </div>

        <div>
          <label htmlFor="rs-emails" style={fieldLabel}>Send to (emails, separated by commas)</label>
          <textarea id="rs-emails" value={emails} onChange={(e) => setEmails(e.target.value)} rows={2}
            placeholder="owner@example.com, manager@example.com, employee@example.com"
            style={{ ...fieldInput, resize: "vertical" }} />
          {badEmails.length > 0 && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: C.red }}>Not a valid email: {badEmails.join(", ")}</p>
          )}
        </div>

        <div>
          <label htmlFor="rs-subject" style={fieldLabel}>Email subject</label>
          <input id="rs-subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={fieldInput} maxLength={300} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          <div>
            <label htmlFor="rs-body" style={fieldLabel}>Email message</label>
            <textarea id="rs-body" ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={22}
              style={{ ...fieldInput, resize: "vertical", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, lineHeight: 1.5 }} />
            <p style={{ margin: "10px 0 6px", fontSize: 12, color: C.muted }}>
              Click a value to insert it where the cursor is. In the email it is replaced by the real number.
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {VARIABLES.map(([v, label]) => (
                <button key={v} type="button" onClick={() => insertVariable(v)} title={`Inserts {{${v}}}`}
                  style={{ ...chip(false), padding: "3px 9px", fontSize: 12 }}>
                  + {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setSubject(DEFAULT_SUBJECT); setBody(DEFAULT_BODY); }}
              style={{ ...btn(), marginTop: 10, fontSize: 12, padding: "6px 12px" }}>
              Reset to default template
            </button>
          </div>

          <div>
            <span style={fieldLabel}>Preview{preview && previewId ? ` — ${employees.find((e) => e.id === previewId)?.name}` : ""}</span>
            {combine && employeeIds.length > 1 && (
              <p style={{ margin: "0 0 8px", fontSize: 12, color: C.muted }}>
                The email repeats this for all {employeeIds.length} employees, one after another.
              </p>
            )}
            <div style={{
              border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", background: C.cardWarm,
              fontSize: 13, lineHeight: 1.6, color: C.text, whiteSpace: "pre-wrap", minHeight: 200,
            }}>
              {!previewId ? (
                <span style={{ color: C.muted }}>Pick an employee to preview with their real numbers.</span>
              ) : !preview ? (
                <span style={{ color: C.muted }}>Loading…</span>
              ) : (
                <>
                  <strong>{render(subject, preview.vars)}</strong>
                  {"\n\n"}
                  {render(body, preview.vars)}
                </>
              )}
            </div>
          </div>
        </div>

        {error && <p role="alert" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.red }}>{error}</p>}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={save} disabled={saving} style={btn(true)}>{saving ? "Saving…" : "Save schedule"}</button>
          <button onClick={() => onDone()} disabled={saving} style={btn()}>Cancel</button>
        </div>
      </div>
    </Card>
  );
}
