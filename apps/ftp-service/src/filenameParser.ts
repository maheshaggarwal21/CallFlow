const FILE_REGEX = /^(\d{2})--([AB])-(\d{1,3})?-*(\d{14})-(.+)\.wav$/i;

export type ParsedFilename = {
  lineNumber: string;
  direction: "inbound" | "outbound";
  intercomCode: string | null;
  calledAt: Date;
  callerPhone: string;
  rawFilename: string;
};

export function parseFilename(filename: string): ParsedFilename | null {
  const match = filename.match(FILE_REGEX);
  if (!match) return null;

  const [, line, dir, intercom, ts, phone] = match;

  const year = ts.slice(0, 4);
  const month = ts.slice(4, 6);
  const day = ts.slice(6, 8);
  const hour = ts.slice(8, 10);
  const minute = ts.slice(10, 12);
  const second = ts.slice(12, 14);

  const calledAt = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);

  return {
    lineNumber: line,
    direction: dir === "A" ? "inbound" : "outbound",
    intercomCode: intercom || null,
    calledAt,
    callerPhone: phone === "Unknown" ? "Unknown" : phone,
    rawFilename: filename,
  };
}
