/**
 * Korecall filename parser — handles all observed separator variants.
 *
 * Actual filename formats (separator count before datetime varies):
 *   {line}--{dir}----{datetime14}-{name}.wav          empty meta, 4 dashes
 *   {line}--{dir}-{short}--{datetime14}-{name}.wav    short intercom, 2 dashes
 *   {line}--{dir}-{number}---{datetime14}-{name}.wav  full number, 3 dashes
 *   {line}--{dir}-{code}----{datetime14}-{name}.wav   code + 4 dashes
 *
 * Strategy: anchor on the 14-digit datetime (year 20xx, validated month/day).
 * Use a lazy match for the meta field so any separator length works.
 */

export type ParsedFilename = {
  lineNumber: string;
  direction: "inbound" | "outbound";
  intercomCode: string | null;
  calledAt: Date;
  callerPhone: string;
  rawFilename: string;
};

// Strict 14-digit datetime: YYYY MM DD HH mm ss, year 20xx, month 01-12, day 01-31
const DT_FRAG = "20\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{6}";

// Main regex: lazy-match the meta field; require ≥1 dash before the datetime
// This matches all separator lengths (--  ---  ----  etc.)
const MAIN_RE = new RegExp(
  `^(\\d{2})--([AB])-(.*?)-+(${DT_FRAG})-(.+)\\.wav$`,
  "i"
);

function buildCalledAt(ts: string): Date | null {
  if (!/^\d{14}$/.test(ts)) return null;

  // Explicitly treat as UTC — Korecall records UTC timestamps.
  // VPS (DigitalOcean Ubuntu) is UTC by default, but being explicit avoids
  // timezone-mismatch bugs if the server is ever reconfigured.
  const iso = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` +
               `T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;

  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractPhoneAndIntercom(metaRaw: string): {
  intercomCode: string | null;
  callerPhone: string;
} {
  // Strip non-digit chars (lazy regex can capture trailing dashes into meta)
  const digits = metaRaw.replace(/\D/g, "");

  if (digits.length === 0) {
    return { intercomCode: null, callerPhone: "Unknown" };
  }

  // IC codes are always the first 3 digits (601, 602, 603, 604, 605 …).
  // The remaining digits are the caller/dialed phone number.
  // If there are fewer than 3 digits total, the whole thing is an IC code.
  if (digits.length < 3) {
    return { intercomCode: digits, callerPhone: "Unknown" };
  }

  const ic    = digits.slice(0, 3);
  const phone = digits.slice(3);

  // Only treat the remainder as a real phone if it has enough digits
  return {
    intercomCode: ic,
    callerPhone:  phone.length >= 7 ? phone : "Unknown",
  };
}

export function parseFilename(filename: string): ParsedFilename | null {
  const m = filename.match(MAIN_RE);
  if (!m) return null;

  const [, line, dir, meta, ts, tail] = m;

  const calledAt = buildCalledAt(ts);
  if (!calledAt) return null;

  const { intercomCode, callerPhone: phoneFromMeta } = extractPhoneAndIntercom(meta);

  // If the tail (last segment before .wav) is a pure digit string it IS the
  // caller number (Korecall sometimes puts the caller number there for inbound).
  // Otherwise it's a label like "Unknown".
  const callerPhone =
    tail && tail.toLowerCase() !== "unknown" && /^\d{7,}$/.test(tail)
      ? tail
      : phoneFromMeta;

  return {
    lineNumber:   line,
    direction:    dir.toUpperCase() === "A" ? "inbound" : "outbound",
    intercomCode,
    calledAt,
    callerPhone,
    rawFilename:  filename,
  };
}
