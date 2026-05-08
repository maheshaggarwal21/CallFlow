const LEGACY_REGEX = /^(\d{2})--([AB])-(\d{1,3})?-*(\d{14})-(.+)\.wav$/i;
const KORECALL_REGEX = /^(\d{2})--([AB])-(.*?)---(\d{14})-(.+)\.wav$/i;

export type ParsedFilename = {
  lineNumber: string;
  direction: "inbound" | "outbound";
  intercomCode: string | null;
  calledAt: Date;
  callerPhone: string;
  rawFilename: string;
};

function buildCalledAt(ts: string): Date | null {
  if (!/^\d{14}$/.test(ts)) return null;

  const year = ts.slice(0, 4);
  const month = ts.slice(4, 6);
  const day = ts.slice(6, 8);
  const hour = ts.slice(8, 10);
  const minute = ts.slice(10, 12);
  const second = ts.slice(12, 14);

  const calledAt = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
  return Number.isNaN(calledAt.getTime()) ? null : calledAt;
}

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Unknown";
  return trimmed.toLowerCase() === "unknown" ? "Unknown" : trimmed;
}

export function parseFilename(filename: string): ParsedFilename | null {
  const legacy = filename.match(LEGACY_REGEX);
  if (legacy) {
    const [, line, dir, intercom, ts, phone] = legacy;
    const calledAt = buildCalledAt(ts);
    if (!calledAt) return null;

    return {
      lineNumber: line,
      direction: dir === "A" ? "inbound" : "outbound",
      intercomCode: intercom || null,
      calledAt,
      callerPhone: normalizePhone(phone),
      rawFilename: filename,
    };
  }

  const korecall = filename.match(KORECALL_REGEX);
  if (!korecall) return null;

  const [, line, dir, meta, ts, tail] = korecall;
  const calledAt = buildCalledAt(ts);
  if (!calledAt) return null;

  const metaDigits = meta.replace(/\D/g, "");
  let intercomCode: string | null = null;
  let callerPhone: string | null = null;

  if (metaDigits.length >= 4) {
    intercomCode = metaDigits.slice(0, 3);
    callerPhone = metaDigits.slice(3);
  } else if (metaDigits.length > 0) {
    intercomCode = metaDigits;
  }

  if (!callerPhone) {
    callerPhone = /^\d+$/.test(tail) ? tail : "Unknown";
  }

  return {
    lineNumber: line,
    direction: dir === "A" ? "inbound" : "outbound",
    intercomCode,
    calledAt,
    callerPhone: normalizePhone(callerPhone),
    rawFilename: filename,
  };
}
