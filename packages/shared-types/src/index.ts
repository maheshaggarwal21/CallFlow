/** Stored rank → what the screens call it: owner = Super Admin, admin = Admin, employee = User. */
export type UserRole = "owner" | "admin" | "employee";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  color_index: number;
  /** Tab keys ticked for this user (Users → Tabs). The Super Admin has every tab without rows. */
  permissions?: string[];
};

export type LoginResponse = {
  user: AuthUser;
};

export type CallSource = "korecall";
export type CallDirection = "inbound" | "outbound";
export type ResolutionStatus = "resolved" | "escalated" | null;

export type EmployeeCallStats = {
  total: number;
  inbound: number;
  outbound: number;
  avg_duration_secs: number;
};

export type Employee = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: "active" | "inactive";
  color_index: number;
  employee_code: number;
  call_stats?: EmployeeCallStats;
  // Users tab (GET /employees)
  designation?: string | null;
  fix_salary?: number;
  trial_commission?: number;
  trial_commission_type?: "pct" | "fix";
  regular_commission?: number;
  regular_commission_type?: "pct" | "fix";
  other_amount?: number;
  target_call_secs?: number;
  target_trial?: number;
  target_regular?: number;
  permissions?: string[];
  line_id?: string | null;
  intercom_id?: string | null;
  extra_commissions?: ExtraCommission[];
  extra_deductions?: ExtraDeduction[];
  team_id?: string | null;
};

/** Teams tab: an office and its agents (GET /teams). */
export type TeamAgent = {
  id: string; name: string; designation: string | null; color_index: number; employee_code: number;
  team_id: string | null; calls_today: number; talk_secs_today: number;
};
export type Team = { id: string; name: string; location: string | null; color_index: number; members: TeamAgent[] };
export type TeamsResponse = { teams: Team[]; unassigned: TeamAgent[] };

/** A flat bonus on a user for a date range (Users form → Extra Commission). Checked by extraSchema in employees.routes.ts. */
export type ExtraCommission = { name: string; amount: number; from: string; to: string };
/** A cut from a user's salary for a date range (Users form → Extra Deduction): ₹ or % of the fix salary. */
export type ExtraDeduction = ExtraCommission & { type: "fix" | "pct" };

export type SystemStatus = {
  ftp_last_sync_at: string | null;
};

export type AudioFormat = "mp3" | "opus";

/** Format of the file actually stored in R2 for a call. */
export type StoredAudioFormat = AudioFormat | "wav";

export type EmployeeName = {
  id: string;
  name: string;
  color_index: number;
};

export type Line = {
  id: string;
  line_number: string;
  employee_id: string | null;
  purpose: string | null;
  assigned_at: string | null;
  employee_name: string | null;
  employee_color_index: number | null;
  /** The agent's Reg No. */
  employee_code: number | null;
  call_count_today: number;
};

export type Intercom = {
  id: string;
  intercom_code: string;
  phone_number: string | null;
  line_number: string | null;
  assigned_at: string | null;
  call_count_total: number;
};

export type Student = {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  created_at: string;
};

export type Call = {
  id: string;
  source: CallSource;
  source_label: string;
  device_id: string | null;
  line_number: string | null;
  intercom_code: string | null;
  intercom_phone_number: string | null;
  call_direction: CallDirection;
  caller_phone: string | null;
  student_name: string | null;
  called_at: string;
  duration_secs: number;
  employee_id: string | null;
  employee_name?: string | null;
  color_index: number | null;
  is_misc: boolean;
  misc_reason: string | null;
  resolution_status: ResolutionStatus;
  /** Short-lived link to the stored recording, whatever its format. */
  audio_presigned_url?: string | null;
  audio_format?: StoredAudioFormat | null;
  /** Short-lived links per playback format. The stored format points straight
   *  at R2; the other is an API path (relative to the API base) that converts
   *  on demand. */
  audio_urls?: Record<AudioFormat, string> | null;
  created_at: string;
  updated_at: string;
};

export type Paginated<T> = {
  data: T[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * One bucket of call volume. The granularity follows the selected date range
 * (hourly for a single day, daily up to two months, monthly beyond), so
 * `day_label` is a display label — "2p", "01 Aug" or "Aug 26" — not always a day.
 */
export type ActivityPoint = {
  /** Bucket key: `YYYY-MM-DD HH`, `YYYY-MM-DD` or `YYYY-MM`, aligned to IST. */
  date: string;
  day_label: string;
  inbound: number;
  outbound: number;
  total: number;
};

/** Resolved analytics window, as instants. */
export type AnalyticsRange = { from: string; to: string };

export type EmployeeAnalytics = {
  total_calls: number;
  inbound: number;
  outbound: number;
  avg_duration_secs: number;
  daily_breakdown: ActivityPoint[];
  range: AnalyticsRange;
};

export type ReportFrequency = "daily" | "weekly" | "monthly";

export type ReportSchedule = {
  id: string;
  name: string;
  employee_ids: string[];
  frequency: ReportFrequency;
  /** IST wall clock, "HH:MM" */
  send_time: string;
  /** Weekly only, 0 = Sunday */
  weekday: number | null;
  recipients: string[];
  subject_template: string;
  body_template: string;
  /** true = all selected employees in one email, false = one email each */
  combine_employees: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ReportScheduleInput = Omit<ReportSchedule, "id" | "created_at" | "updated_at">;

export type ReportRun = {
  id: string;
  schedule_id: string;
  schedule_name: string;
  /** null for a combined (one email for everyone) send */
  employee_id: string | null;
  employee_name: string;
  period_key: string;
  status: "sending" | "sent" | "failed";
  attempts: number;
  error: string | null;
  sent_at: string | null;
  created_at: string;
};

/** Report figures as display strings, keyed by template variable name. */
export type ReportPreview = { vars: Record<string, string> };

/** GET /reports/data — the report dashboard; same figures as the emailed report. */
export type ReportPerson = {
  id?: string; name: string; code: string; line: string;
  calls: number; inb: number; out: number; dur: number; avg: number; lt10: number;
  gapMin: number | null; gapMax: number | null; invalid: number;
  len: [number, number][]; // [in, out] for 10 / 11 / 12 digits / other
  b: number[];             // calls per length band: <30s, 30–60s, 1–2, 2–3, 3–5, 5–10, 10–15, 15+ min
  hours: number[];         // calls per hour, aligned with ReportData.hours
  short: number; meaningful: number; invPct: number;
  funnel: number[];        // dialled, 10s+, 30s+, 1 min+, 3 min+
  status: [string, "ok" | "bad" | "neu"];
};
export type ReportData = {
  title: string; period: string;
  hours: number[]; // IST hours of day on the x-axis
  team: { calls: number; inb: number; out: number; dur: number; invalid: number; b: number[]; hours: number[]; funnel: number[]; avg: number | null; peakHour: number | null };
  people: ReportPerson[]; // only people with calls, by talk time
  idle: string[];
  top: string | null;     // employee code of the top performer
  insights: string[];     // HTML (<b> only, names escaped server-side)
  canCompare: boolean;
};
