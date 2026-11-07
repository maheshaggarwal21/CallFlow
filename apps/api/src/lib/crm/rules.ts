import { z } from "zod";
import { istMidnight, istParts } from "../dateRange";

// The client's own outcome codes; the letters must not change.
export const CODES = ["A", "B", "C", "D", "E", "F", "Z"] as const;
export type Code = (typeof CODES)[number];
export const RETRY_CODES: readonly Code[] = ["A", "B", "C"];
export const CALLBACK_CODES: readonly Code[] = ["D", "E"];
/** The rep says they spoke to the student. */
export const TALKED_CODES: readonly Code[] = ["D", "E", "F", "Z"];
/** Matched recordings for these are kept past the 90-day retention. */
export const KEEP_AUDIO_CODES: readonly Code[] = ["F", "Z"];

export const PERMISSIONS = ["export_leads"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const TRIAL_AMOUNT = 299; // the only product
export const INVALID_REASON = "Invalid number";
export const MIN_NOTE = 15;

export type RetryRule = { hours?: number; next_day_at?: string };
export type RetryRules = { A?: RetryRule; B?: RetryRule; C?: RetryRule; invalid?: { never?: boolean }; max_attempts?: number };
export const DEFAULT_RETRY: Required<Pick<RetryRules, "A" | "B" | "C" | "max_attempts">> & RetryRules = {
  A: { hours: 6 }, B: { hours: 3 }, C: { next_day_at: "10:00" }, invalid: { never: true }, max_attempts: 6,
};

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
  code: z.enum(CODES),
  reason: z.string().trim().max(150).nullish(),
  note: z.string().trim().max(2000).nullish(),
  callback_at: z.string().datetime({ offset: true }).nullish(),
  amount: z.number().positive().max(100000).nullish(),
  assigned_to: z.string().uuid().nullish(),
  has_guitar: z.boolean().nullish(),
});
export type OutcomeInput = z.infer<typeof outcomeSchema>;

/** Business rules the schema can't express. Returns the first problem, or null. */
export function validateOutcome(o: OutcomeInput, now: Date): string | null {
  const needsCallback = CALLBACK_CODES.includes(o.code);
  if (needsCallback || o.code === "F") {
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
export function nextState(prevAttempts: number, o: OutcomeInput, rules: RetryRules, now: Date): LeadState {
  const base = { current_code: o.code, amount: o.amount ?? null };
  if (RETRY_CODES.includes(o.code)) {
    const attempts = prevAttempts + 1;
    const max = rules.max_attempts ?? DEFAULT_RETRY.max_attempts;
    const invalid = o.reason === INVALID_REASON && rules.invalid?.never !== false;
    if (invalid || attempts >= max) return { ...base, status: "dropped", next_followup_at: null, attempts };
    const rule = rules[o.code as "A" | "B" | "C"] ?? DEFAULT_RETRY[o.code as "A" | "B" | "C"];
    return { ...base, status: "retry", next_followup_at: o.callback_at ? new Date(o.callback_at) : retryAt(rule, now), attempts };
  }
  if (CALLBACK_CODES.includes(o.code)) {
    return { ...base, status: "callback", next_followup_at: new Date(o.callback_at!), attempts: 0 };
  }
  if (o.code === "F") return { ...base, status: "converted", next_followup_at: null, attempts: 0, amount: o.amount ?? TRIAL_AMOUNT };
  return { ...base, status: "dnc", next_followup_at: null, attempts: 0 };
}
