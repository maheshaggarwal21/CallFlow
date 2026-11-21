// Silent-office alert (client, 21 Nov 2026): Office 2's KoreCall stopped uploading at 09:44 and nobody knew until 15:35.
// Office 1 = lines 01–04, Office 2 = lines 05–08 (the client's own lines). Checked 09:00–18:00 IST on working days.
export const OFFICE_LINES = { 1: ["01", "02", "03", "04"], 2: ["05", "06", "07", "08"] } as const;
/** Which office's KoreCall made a file: "{pbx}-{own line}-…" goes by the own line, the old "{pbx}--…" is Office 1. */
export function officeOfFile(key: string): 1 | 2 {
  const m = key.split("/").pop()!.match(/^(\d{2})-(\d*)-/);
  return m && Number(m[2] || m[1]) >= 5 ? 2 : 1;
}
export const WATCH_FROM = "09:00";
export const WATCH_TO = "18:00";
const MIN = 60_000;
export const SILENT_MS = 20 * MIN;       // one office quiet this long…
export const OTHER_ACTIVE_MS = 10 * MIN; // …while the other sent something this recently
export const BOTH_SILENT_MS = 30 * MIN;  // neither office: our server or the internet

export type Who = "1" | "2" | "both";
export type Alerted = Partial<Record<Who, boolean>>;
export type Action = { kind: "silent" | "back"; who: Who; since: number };

/**
 * What to mail now. `last1`/`last2` = latest upload today (ms) or null; quiet time counts from `dayStart` (09:00)
 * at the earliest, so the night doesn't count. One mail when a problem starts, one when it ends.
 */
export function decide(now: number, dayStart: number, last1: number | null, last2: number | null, alerted: Alerted): Action[] {
  const since1 = Math.max(last1 ?? 0, dayStart);
  const since2 = Math.max(last2 ?? 0, dayStart);
  const out: Action[] = [];

  const bothQuiet = now - Math.max(since1, since2) >= BOTH_SILENT_MS;
  if (bothQuiet && !alerted.both) out.push({ kind: "silent", who: "both", since: Math.max(since1, since2) });
  if (!bothQuiet && alerted.both) out.push({ kind: "back", who: "both", since: Math.max(since1, since2) });

  for (const [who, since, otherLast] of [["1", since1, last2], ["2", since2, last1]] as const) {
    const quiet = now - since >= SILENT_MS;
    const otherBusy = otherLast != null && now - otherLast <= OTHER_ACTIVE_MS;
    if (quiet && otherBusy && !alerted[who] && !alerted.both && !bothQuiet) out.push({ kind: "silent", who, since });
    if (!quiet && alerted[who]) out.push({ kind: "back", who, since });
  }
  return out;
}
