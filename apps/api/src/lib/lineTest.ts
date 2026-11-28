import { randomInt } from "node:crypto";
// The connection test (client, 28 Nov 2026): a rep dials the random number shown to them from their desk phone and holds
// it for TEST_MIN_SECS. The KoreCall box records it under the line the phone is really wired to; if that is the line
// the rep picked, they are connected. Recordings reach the server 8 s (Office 1, median) to ~3 min after hang-up,
// hence the long window. Matching is on arrival time (created_at), never the PBX's own clock, which drifts.
export const TEST_WINDOW_MS = 3 * 60_000;
export const TEST_MIN_SECS = 10;
// A connection ends after IDLE_MS with no touch on the dashboard and no call recorded on its line (client, 28 Nov
// 2026). The page asks "Are you there?" at IDLE_MS and logs out a minute later; the server frees lines whose page was
// closed, after the minute and a little slack for the page's once-a-minute ping.
export const IDLE_MS = 45 * 60_000;
export const SERVER_IDLE_MS = IDLE_MS + 2 * 60_000;

export type TestCall = { id: string; line_number: string; caller_phone: string; duration_secs: number; created_at: Date };

const tail = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
/** 0172-xxx, +91 98…, 98… are the same number when their last 10 digits (or all of a shorter one) match */
export const sameNumber = (a: string | null | undefined, b: string | null | undefined) => {
  const x = tail(a), y = tail(b);
  return x.length >= 6 && x === y;
};

/**
 * Among outbound calls that arrived since the test began: the test call on the picked line, and else one on another
 * line (the rep's phone is wired to that line instead).
 */
export function findTestCall(lineNumber: string, testNumber: string, startedAt: Date, calls: TestCall[]) {
  const ok = calls.filter((c) => c.created_at >= startedAt && c.duration_secs >= TEST_MIN_SECS && sameNumber(c.caller_phone, testNumber));
  return { hit: ok.find((c) => c.line_number === lineNumber) ?? null, elsewhere: ok.find((c) => c.line_number !== lineNumber) ?? null };
}

/**
 * The number a rep dials for their test (client, 28 Nov 2026): random, 10 digits. It needn't exist: KoreCall records
 * whatever is dialled. Starts 6–9 (mobile form) because a landline must prefix 0 to reach a mobile, so dialling it
 * plain gets the exchange's announcement and rings no stranger, and it never starts 1 (100, 108, 112 are emergency).
 */
export const randomTestNumber = () => String(randomInt(6, 10)) + Array.from({ length: 9 }, () => randomInt(0, 10)).join("");

/** "98******66": first two and last two digits */
export const maskPhone = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length < 5 ? "" : `${d.slice(0, 2)}${"*".repeat(d.length - 4)}${d.slice(-2)}`;
};
