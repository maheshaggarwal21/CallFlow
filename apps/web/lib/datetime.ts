// Canonical timezone for every call timestamp. The KoreCall PBX records in IST
// and the FTP service tags ingested timestamps as +05:30, so call instants are
// always displayed in IST regardless of the viewer's own browser timezone.
const IST = "Asia/Kolkata";

/** 12-hour time with AM/PM, e.g. "2:54 PM". */
export function fmtTime(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  });
}

/** Short date, e.g. "11 Jun". */
export function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: IST,
  });
}

/** Long date, e.g. "11 Jun 2026". */
export function fmtDateLong(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: IST,
  });
}
