// CRM prototype: feature flag, outcome codes and the shapes returned by /api/v1/crm.
// The whole CRM UI is hidden unless NEXT_PUBLIC_CRM_ENABLED=true (inlined at build time).
export const CRM_ENABLED = process.env.NEXT_PUBLIC_CRM_ENABLED === "true";

export type Code = "A" | "B" | "C" | "D" | "E" | "F" | "Z";
export const CODES: { code: Code; label: string; rule: string; kind: "retry" | "callback" | "paid" | "closed" }[] = [
  { code: "A", label: "Didn't connect", rule: "Switched off / not reachable · retry later", kind: "retry" },
  { code: "B", label: "Rang, not picked", rule: "Retry later", kind: "retry" },
  { code: "C", label: "Picked up and cut", rule: "Retry later", kind: "retry" },
  { code: "D", label: "Talked, call me later", rule: "Callback date + time · note", kind: "callback" },
  { code: "E", label: "Interested, pays later", rule: "Callback date + time · note", kind: "callback" },
  { code: "F", label: "Paid ₹299 trial", rule: "Note · amount", kind: "paid" },
  { code: "Z", label: "Not interested", rule: "Never call again", kind: "closed" },
];
export const codeMeta = (c: string | null | undefined) => CODES.find((x) => x.code === c);
export const MIN_NOTE = 15;

export const PERMISSION_LABELS: Record<string, string> = {
  manage_questions: "Manage questions",
  manage_templates: "Manage reasons & note templates",
  reassign_leads: "Revive / reassign leads",
  export_leads: "Export leads",
  view_crm_reports: "View CRM reports",
};

export const STATUS_LABEL: Record<string, string> = {
  new: "New", retry: "Retry", callback: "Callback", converted: "Converted", dnc: "Do not call", dropped: "Dropped",
};
export const CHECK_LABEL: Record<string, string> = {
  no_answer: "No answer", busy: "Busy", switched_off: "Switched off", invalid_number: "Invalid number", possible_conversation: "Possible conversation",
};
export const LIKELY_LABEL = "Likely conversations (≥30 s, coded D/E/F/Z)";

/** "9465658112" → "94656 58112", easy to read out while dialling. */
export const groupPhone = (p: string) => (p?.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p ?? "");

const IST = "Asia/Kolkata";
export const fmtWhen = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  const day = dt.toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "short" });
  const today = new Date().toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "short" });
  const time = dt.toLocaleTimeString("en-US", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true });
  return day === today ? `Today ${time}` : `${day} ${time}`;
};
export const fmtAgo = (d: string | Date | null | undefined, now = Date.now()) => {
  if (!d) return "—";
  const m = Math.round((now - new Date(d).getTime()) / 60_000);
  if (Math.abs(m) < 60) return m >= 0 ? `${m} min ago` : `in ${-m} min`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return h >= 0 ? `${h} h ago` : `in ${-h} h`;
  return fmtWhen(d);
};

export type LastCall = { id: string; duration_secs: number; called_at: string; has_audio: boolean } | null;
export type LeadRow = {
  id: string; lead_code: string; name: string; phone10: string; source: string | null; campaign: string | null;
  status: string; current_code: Code | null; attempts: number; last_contacted_at: string | null; next_followup_at: string | null;
  created_at: string; amount: string | null; tags: string[]; student_set_time: boolean;
  locked_by: string | null; locked_by_name: string | null; callback_set_by_name: string | null; callback_note?: string | null;
  assigned_to?: string | null; assigned_to_name?: string | null;
  last_call: LastCall; bucket?: "due_now" | "overdue" | "new" | "retry" | "later";
};
export type QueueResponse = {
  server_now: string;
  counts: Record<string, number>;
  sections: Record<"due_now" | "overdue" | "new" | "retry" | "later", LeadRow[]>;
  kpis: { due_now: number; overdue: number; new_today: number; converted_today: number; my_calls_today: number; my_leads: number };
};

export type CallInfo = {
  id: string; called_at: string; duration_secs: number; direction: string; employee_id: string | null; employee_name: string | null;
  keep_audio: boolean; check: { label: string; confidence: number } | null;
  audio_urls: { opus: string; mp3: string } | null; audio_format: string | null; audio_state: "ok" | "expired" | "missing";
};
export type TimelineEntry =
  | { type: "interaction"; at: string; id: string; kind: "call_outcome" | "whatsapp" | "system" | "reenquiry"; code: Code | null; reason: string | null; employee_id: string | null;
      note: string | null; next_followup_at: string | null; employee_name: string | null; template_label: string | null;
      meta: Record<string, unknown> | null; call: CallInfo | null; contradiction: boolean }
  | { type: "call"; at: string; call: CallInfo };
export type LeadDetail = {
  lead: LeadRow & { email: string | null; phone_raw: string; answers: { question_id: string; label: string; value: string }[];
    version: number; locked_until: string | null; updated_by_name: string | null; external_id: string | null };
  timeline: TimelineEntry[];
  /** Assignment changes, newest first (owner assigns + D/E callbacks); name null = back to the shared pool */
  assignments: { at: string; name: string | null; by_name: string | null; previous_name: string | null }[];
  wa_vars: Record<string, string>;
  callback_note: string | null;
  server_now: string;
};
export type CrmConfig = {
  questions: { id: string; label: string; type: "yesno" | "select" | "text"; options: string[] }[];
  reasons: { id: string; label: string; codes: Code[] }[];
  note_templates: { id: string; label: string; text: string; codes: Code[]; category: string | null }[];
  wati_templates: { id: string; name: string; label: string; body: string }[];
  wati_mode: "mock" | "live";
  reps: { id: string; name: string }[];
  retry_rules: { A?: RetryRule; B?: RetryRule; C?: RetryRule; invalid?: { never?: boolean }; max_attempts?: number };
};
export type RetryRule = { hours?: number; next_day_at?: string };
export type CrmMe = { permissions: string[]; is_owner: boolean };

export const fillVars = (body: string, vars: Record<string, string>) => body.replace(/\{(\w+)\}/g, (m, k) => vars[k] || m);

/** What the form will set as the next follow-up, shown live in the siren banner before saving. */
export type FollowUpDraft = { at: string | null; repName: string | null; kind: "callback" | "auto" | "none"; text: string } | null;
