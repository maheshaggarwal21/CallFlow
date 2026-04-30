export type UserRole = "owner" | "employee";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  color_index: number;
};

export type LoginResponse = {
  user: AuthUser;
};

export type CallSource = "korecall" | "android_app";
export type CallDirection = "inbound" | "outbound";
export type CallAiStatus = "pending" | "processing" | "done" | "failed";
export type ResolutionStatus = "resolved" | "escalated" | null;
export type Sentiment = "positive" | "negative" | "neutral" | null;

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
  call_stats?: EmployeeCallStats;
};

export type SystemStatus = {
  ftp_last_sync_at: string | null;
  android_last_sync_at: string | null;
  ai_queue_pending: number;
};

export type EmployeeName = {
  id: string;
  name: string;
  color_index: number;
};

export type DeviceName = {
  id: string;
  device_name: string;
};

export type Line = {
  id: string;
  line_number: string;
  employee_id: string | null;
  purpose: string | null;
  assigned_at: string | null;
  employee_name: string | null;
  employee_color_index: number | null;
  call_count_today: number;
};

export type Intercom = {
  id: string;
  intercom_code: string;
  phone_number: string | null;
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
  audio_presigned_url?: string | null;
  ai_status: CallAiStatus;
  summary: string | null;
  transcript_raw: string | null;
  transcript_json: Array<{ speaker: "Agent" | "Caller"; text: string }> | null;
  sentiment: Sentiment;
  created_at: string;
  updated_at: string;
};

export type CallListResponse = {
  data: Call[];
  total: number;
  limit: number;
  offset: number;
};

export type Paginated<T> = {
  data: T[];
  total: number;
  limit: number;
  offset: number;
};

export type LineStatus = {
  line: string;
  employee_name: string | null;
  call_count_today: number;
};

export type OverviewStats = {
  total_calls: number;
  inbound: number;
  outbound: number;
  avg_duration_secs: number;
  mom_delta: {
    total_pct: number | null;
    inbound_pct: number | null;
    outbound_pct: number | null;
    avg_duration_secs: number;
  };
  direction_split: { inbound_pct: number; outbound_pct: number };
  team_split: Array<{ employee_id: string; name: string; count: number; pct: number; color_index: number }>;
  weekly_activity: Array<{ day_label: string; inbound: number; outbound: number }>;
  csat_score: number;
  resolved_count: number;
  escalated_count: number;
  top_line: { line_number: string; call_count: number } | null;
  line_status: LineStatus[];
  recent_calls: Call[];
};

export type EmployeeAnalytics = {
  total_calls: number;
  inbound: number;
  outbound: number;
  avg_duration_secs: number;
  csat_score: number;
  daily_breakdown: Array<{
    date: string;
    day_label: string;
    inbound: number;
    outbound: number;
    total: number;
  }>;
};

export type MiscCountStats = {
  count: number;
  avg_duration_secs: number;
  disconnected_count: number;
  no_response_count: number;
};
