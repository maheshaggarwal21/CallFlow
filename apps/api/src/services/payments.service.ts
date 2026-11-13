/**
 * The school site's payments, per rep (client, 13 Nov 2026):
 *   GET {PAYMENTS_API_URL}/api/v1/partner/payments?callFlowId&startDate&endDate&page&limit   (x-api-key)
 * `callFlowId` is our employees.id. The key stays on this server: it is never logged or sent to the browser.
 * Only the fields CallFlow shows are kept (no student email or phone). Every answer is checked with zod, so a changed or broken response fails loudly instead of paying wrong.
 */
import { z } from "zod";

const base = () => (process.env.PAYMENTS_API_URL ?? "").replace(/\/$/, "");
export const paymentsConfigured = () => !!(base() && process.env.PAYMENTS_API_KEY);

const PAGE = 100;      // their maximum
const MAX_PAGES = 20;  // 2,000 payments for one rep in one period; more than that is a mistake, not a month
const TTL_MS = 2 * 60_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const paymentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(200).catch(""),
  amountPaise: z.number().int().min(0).max(1_000_000_000),
  paidDate: z.string().regex(DAY),
  paymentMode: z.string().max(60).nullish().transform((v) => v ?? ""),
  feeType: z.string().max(60).nullish().transform((v) => v ?? ""),
  linkedTo: z.string().max(40).nullish().transform((v) => v ?? ""),
  // only an https link is passed on, so a bad value can never become a javascript: link in the browser
  receiptUrl: z.string().max(2000).nullish().transform((v) => (v && /^https:\/\//i.test(v) ? v : null)),
});
const answerSchema = z.object({
  data: z.object({
    payments: z.array(paymentSchema),
    pagination: z.object({ pages: z.number().int().min(0) }),
  }),
});

export type Payment = z.infer<typeof paymentSchema>;
export class PaymentsError extends Error {}

async function page(callFlowId: string, startDate: string, endDate: string, n: number) {
  const q = new URLSearchParams({ callFlowId, startDate, endDate, page: String(n), limit: String(PAGE) });
  let res: Response;
  try {
    res = await fetch(`${base()}/api/v1/partner/payments?${q}`, {
      headers: { "x-api-key": process.env.PAYMENTS_API_KEY!, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      redirect: "error", // never follow a redirect with the key on it
    });
  } catch (e) {
    throw new PaymentsError(`The school's payments service did not answer (${(e as Error).name === "TimeoutError" ? "timed out" : "no connection"})`);
  }
  const text = await res.text();
  if (!res.ok) {
    // their reply goes to the server log only: it could echo the request, key included
    console.error(`[payments] ${res.status} for ${callFlowId}: ${text.slice(0, 300).split(process.env.PAYMENTS_API_KEY!).join("<key>")}`);
    throw new PaymentsError(res.status === 401 || res.status === 403
      ? "The school's payments service refused our key"
      // their answer for a rep they haven't linked: "No user found for this callFlowId"
      : res.status === 404 ? "This person isn't linked on the school site yet (the school site needs their CallFlow ID)"
      : `The school's payments service answered ${res.status}`);
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new PaymentsError("The school's payments service sent an unreadable answer"); }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new PaymentsError(`The school's payments answer has an unexpected shape (${i.path.join(".")}: ${i.message})`);
  }
  return parsed.data.data;
}

const cache = new Map<string, { at: number; list: Payment[] }>();

/** Every payment by one rep from `startDate` to `endDate` (IST dates, both included), newest first. */
export async function paymentsFor(callFlowId: string, startDate: string, endDate: string): Promise<Payment[]> {
  if (!paymentsConfigured()) throw new PaymentsError("Payments are not connected yet (PAYMENTS_API_URL / PAYMENTS_API_KEY)");
  // the key must not travel in clear text to a live server
  if (process.env.NODE_ENV === "production" && !base().startsWith("https://")) throw new PaymentsError("PAYMENTS_API_URL must be https in production");
  if (!z.string().uuid().safeParse(callFlowId).success || !DAY.test(startDate) || !DAY.test(endDate) || startDate > endDate) {
    throw new PaymentsError("Bad payments query");
  }
  const key = `${callFlowId}|${startDate}|${endDate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.list;

  const first = await page(callFlowId, startDate, endDate, 1);
  if (first.pagination.pages > MAX_PAGES) throw new PaymentsError(`Too many payments to add up (${first.pagination.pages} pages); pick a shorter period`);
  const rest = await Promise.all(Array.from({ length: Math.max(0, first.pagination.pages - 1) }, (_, i) => page(callFlowId, startDate, endDate, i + 2)));
  // a payment can move between pages while we read; keep each id once
  const byId = new Map<string, Payment>();
  for (const p of [first, ...rest].flatMap((d) => d.payments)) byId.set(p.id, p);
  const list = [...byId.values()].sort((a, b) => (a.paidDate < b.paidDate ? 1 : a.paidDate > b.paidDate ? -1 : 0));

  for (const [k, v] of cache) if (Date.now() - v.at >= TTL_MS) cache.delete(k);
  cache.set(key, { at: Date.now(), list });
  return list;
}
