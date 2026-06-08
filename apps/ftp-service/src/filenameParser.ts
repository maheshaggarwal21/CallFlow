export type ParsedFilename = {
  lineNumber: string;
  direction: "inbound" | "outbound";
  intercomCode: string | null;
  calledAt: Date;
  callerPhone: string;
  rawFilename: string;
};

// Timestamp fragment: 14-digit YYYYMMDDHHmmss after the triple-dash separator
const DT_FRAG = "20\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{6}";

// New filename format (no intercom code):
//   {line:2d}--{A|B}-{phone:digits}---{timestamp:14d}-{tail}.wav
// e.g. 03--B-09465658112---20250524112115-Unknown.wav
//
// Phone is captured as (\d+) — variable length, digits only, guaranteed to be
// taken from between the direction marker and the triple-dash separator.
const MAIN_RE = new RegExp(
  "^(\\d{2})--([AB])-(\\d+)---(" + DT_FRAG + ")-(.+)\\.wav$",
  "i"
);

function buildCalledAt(ts: string): Date | null {
  if (!/^\d{14}$/.test(ts)) return null;
  const iso =
    ts.slice(0, 4) + "-" +
    ts.slice(4, 6) + "-" +
    ts.slice(6, 8) + "T" +
    ts.slice(8, 10) + ":" +
    ts.slice(10, 12) + ":" +
    ts.slice(12, 14);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseFilename(filename: string): ParsedFilename | null {
  const m = filename.match(MAIN_RE);
  if (!m) return null;

  const [, line, dir, phoneRaw, ts] = m;

  const calledAt = buildCalledAt(ts);
  if (!calledAt) return null;

  // Phone is the raw digit sequence captured between the direction marker and ---
  // intercomCode is always null in the new format (intercom removed from filenames)
  const callerPhone = phoneRaw.length > 0 ? phoneRaw : "Unknown";

  return {
    lineNumber: line,
    direction: dir.toUpperCase() === "A" ? "inbound" : "outbound",
    intercomCode: null,
    calledAt,
    callerPhone,
    rawFilename: filename,
  };
}
