// CRM prototype: feature flag, outcome codes and the shapes returned by /api/v1/crm.
// The whole CRM UI is hidden unless NEXT_PUBLIC_CRM_ENABLED=true (inlined at build time).
export const CRM_ENABLED = process.env.NEXT_PUBLIC_CRM_ENABLED === "true";

// The sheet's status letters (one capital letter each). Which exist, and the label and role of each,
// are set by the owner in CRM Settings (/crm/config); the owner can add letters.
export const CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export type Code = string;
export type Role = "retry" | "callback" | "paid" | "closed" | "other" | "unused";
export type CodeSetting = { label: string; role: Role; hours?: number; next_day_at?: string; description?: string };
export type CodeMeta = CodeSetting & { code: Code; kind: Role; rule: string };
export const ROLE_LABEL: Record<Role, string> = {
  retry: "No contact · follows up by itself", callback: "Talked · rep sets the follow-up",
  paid: "Converted (paid)", closed: "Closed · no more calls", other: "Other (write what it does)", unused: "Not used",
};
const ruleText = (s: CodeSetting) =>
  s.role === "retry" ? `No contact · retried ${s.next_day_at ? `next day at ${s.next_day_at}` : `after ${s.hours ?? 3} h`}`
  : s.role === "other" ? s.description || "Other" : ROLE_LABEL[s.role];
/** The codes in the settings, A→Z. */
export const codeList = (codes?: Record<Code, CodeSetting>): CodeMeta[] =>
  Object.keys(codes ?? {}).sort().map((code) => {
    const s = codes![code];
    return { ...s, code, kind: s.role, rule: ruleText(s) };
  });
export const MIN_NOTE = 15;
/** Same window as the server: a follow-up is "due" 15 min either side of its time. */
export const DUE_WINDOW_MS = 15 * 60_000;

export const PERMISSION_LABELS: Record<string, string> = {
  export_leads: "Export leads",
};

export const STATUS_LABEL: Record<string, string> = {
  new: "New", retry: "Retry", callback: "Callback", converted: "Converted", dnc: "Do not call", dropped: "Dropped",
};
/** What the client calls the lead's state: "New", "Dropped", else the last outcome's label. */
export const statusLabel = (l: { status: string; current_code: Code | null }, m?: CodeMeta) =>
  l.status === "new" || l.status === "dropped" || !l.current_code ? STATUS_LABEL[l.status] ?? l.status : m?.label ?? `Code ${l.current_code}`;

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
  created_at: string; amount: string | null; tags: string[];
  locked_by: string | null; locked_by_name: string | null; callback_set_by_name: string | null;
  assigned_to?: string | null; assigned_to_name?: string | null; has_guitar: boolean | null;
  last_call: LastCall; bucket?: "due_now" | "overdue" | "new" | "retry" | "later";
};
export type QueueResponse = {
  server_now: string;
  counts: Record<string, number>;
  sections: Record<"due_now" | "overdue" | "new" | "retry" | "later", LeadRow[]>;
  kpis: { due_now: number; overdue: number; total: number; new_leads: number; due_today: number; converted: number };
};

export type CallInfo = {
  id: string; called_at: string; duration_secs: number; direction: string; employee_id: string | null; employee_name: string | null;
  keep_audio: boolean;
  audio_urls: { opus: string; mp3: string } | null; audio_format: string | null; audio_state: "ok" | "expired" | "missing";
};
export type TimelineEntry =
  | { type: "interaction"; at: string; id: string; kind: "call_outcome" | "system" | "reenquiry"; code: Code | null; reason: string | null; employee_id: string | null;
      note: string | null; next_followup_at: string | null; employee_name: string | null;
      meta: Record<string, unknown> | null; call: CallInfo | null }
  | { type: "call"; at: string; call: CallInfo };
export type LeadDetail = {
  lead: LeadRow & { email: string | null; phone_raw: string;
    version: number; locked_until: string | null; updated_by_name: string | null; external_id: string | null };
  timeline: TimelineEntry[];
  server_now: string;
};
export type CrmConfig = {
  reps: { id: string; name: string }[];
  retry_rules: { invalid?: { never?: boolean }; max_attempts?: number };
  codes: Record<Code, CodeSetting>;
};
export type CrmMe = { permissions: string[]; is_owner: boolean };
