import { z } from "zod";
import { istMidnight, istParts } from "../dateRange";

// The client's sheet codes: one capital letter each. Which letters exist and what each means is a
// CRM setting ("codes") the owner edits; new letters can be added there.
export const CODE_RE = /^[A-Z]$/;
export type Code = string;
/** retry: no contact, follows up by itself · callback: talked, rep sets the time · paid: converted ·
 *  closed: no more calls · unused: not offered in the form */
export const ROLES = ["retry", "callback", "paid", "closed", "unused"] as const;
export type Role = (typeof ROLES)[number];
export type CodeSetting = { label: string; role: Role; hours?: number; next_day_at?: string };
export type CodeSettings = Record<Code, CodeSetting>;
/** The setting's own letters, A→Z. */
export const codeLetters = (codes: CodeSettings) => Object.keys(codes).filter((c) => CODE_RE.test(c)).sort();

/** The local demo's and the tests' codes. Production holds the client's own set (migration 013). */
export const DEFAULT_CODES: CodeSettings = {
  A: { label: "Not reachable", role: "retry", hours: 6 }, B: { label: "No response", role: "retry", hours: 3 },
  C: { label: "Call cut", role: "retry", next_day_at: "10:00" }, D: { label: "Call later", role: "callback" },
  E: { label: "Will pay later", role: "callback" }, F: { label: "Converted", role: "paid" },
  G: { label: "Not interested", role: "closed" },
};
/** Lead status a code puts the lead in (before the drop limit). */
export const STATUS_OF_ROLE: Record<Role, LeadState["status"]> = { retry: "retry", callback: "callback", paid: "converted", closed: "dnc", unused: "dnc" };
/** Matched recordings of these roles are kept past the 90-day retention. */
export const keepsAudio = (role: Role | undefined) => role === "paid" || role === "closed";

export const PERMISSIONS = ["export_leads"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const TRIAL_AMOUNT = 299; // the only product
export const INVALID_REASON = "Invalid number";
export const MIN_NOTE = 15;

export type RetryRule = { hours?: number; next_day_at?: string };
/** max_attempts: drop the lead after this many "no contact" saves in a row; 0 = never (client, 7 Nov). */
export type RetryRules = { invalid?: { never?: boolean }; max_attempts?: number };
export const DEFAULT_RETRY: Required<Pick<RetryRules, "max_attempts">> & RetryRules = { invalid: { never: true }, max_attempts: 0 };

/** When a retry becomes due: now + N hours, or the next IST day at HH:MM. */
export function retryAt(rule: RetryRule | undefined, now: Date): Date {
  if (rule?.next_day_at) {
    const [h, m] = rule.next_day_at.split(":").map(Number);
    const p = istParts(now);
    return new Date(istMidnight(p.year, p.month, p.day + 1).getTime() + (h * 60 + m) * 60_000);
  }
  return new Date(now.getTime() + (rule?.hours ?? 3) * 3_600_000);
}

export const outcomeSchema = z.object({
  version: z.number().int().positive(),
  code: z.string().regex(CODE_RE, "Code must be one capital letter"),
  reason: z.string().trim().max(150).nullish(),
  note: z.string().trim().max(2000).nullish(),
  callback_at: z.string().datetime({ offset: true }).nullish(),
  amount: z.number().positive().max(100000).nullish(),
  assigned_to: z.string().uuid().nullish(),
  has_guitar: z.boolean().nullish(),
});
export type OutcomeInput = z.infer<typeof outcomeSchema>;

/** Business rules the schema can't express. Returns the first problem, or null. */
export function validateOutcome(o: OutcomeInput, now: Date, codes: CodeSettings = DEFAULT_CODES): string | null {
  const role = codes[o.code]?.role ?? "unused";
  if (role === "unused") return `Code ${o.code} is not in use (CRM Settings)`;
  const needsCallback = role === "callback";
  if (needsCallback || role === "paid") {
    if ((o.note ?? "").length < MIN_NOTE) return `Code ${o.code} needs a note of at least ${MIN_NOTE} characters`;
  }
  if (needsCallback && !o.callback_at) return `Code ${o.code} needs a callback date and time`;
  // Retry codes may also carry a follow-up time the rep chose instead of the automatic one
  if (o.callback_at) {
    const at = new Date(o.callback_at).getTime();
    if (at < now.getTime() - 60_000) return "The callback time is in the past";
    if (at > now.getTime() + 90 * 86_400_000) return "The callback is more than 90 days away";
  }
  return null;
}

export type LeadState = {
  status: "new" | "retry" | "callback" | "converted" | "dnc" | "dropped";
  current_code: Code;
  next_followup_at: Date | null;
  attempts: number;
  amount: number | null;
};

/** The lead after a saved outcome. `attempts` counts failed tries since the last real contact. */
export function nextState(prevAttempts: number, o: OutcomeInput, rules: RetryRules, now: Date, codes: CodeSettings = DEFAULT_CODES): LeadState {
  const base = { current_code: o.code, amount: o.amount ?? null };
  const c = codes[o.code];
  if (c?.role === "retry") {
    const attempts = prevAttempts + 1;
    const max = rules.max_attempts ?? DEFAULT_RETRY.max_attempts;
    const invalid = o.reason === INVALID_REASON && rules.invalid?.never !== false;
    if (invalid || (max > 0 && attempts >= max)) return { ...base, status: "dropped", next_followup_at: null, attempts };
    return { ...base, status: "retry", next_followup_at: o.callback_at ? new Date(o.callback_at) : retryAt(c, now), attempts };
  }
  if (c?.role === "callback") {
    return { ...base, status: "callback", next_followup_at: new Date(o.callback_at!), attempts: 0 };
  }
  if (c?.role === "paid") return { ...base, status: "converted", next_followup_at: null, attempts: 0, amount: o.amount ?? TRIAL_AMOUNT };
  return { ...base, status: "dnc", next_followup_at: null, attempts: 0 };
}
