// Security emails from the recording receiver (client, 25 Nov 2026): an address blocked for guessing the FTP login, or
// someone logged in with the real login uploading files that aren't recordings (the break-in seen that day).
// Bots try all day, so it never mails more than once an hour: the first event goes at once, later ones are collected
// and sent together, each counted. Recipients: SECURITY_ALERT_TO (comma-separated); mail goes through Resend like the
// API's reports (RESEND_API_KEY, REPORT_MAIL_FROM). Without them it only logs.
export const MIN_GAP_MS = 60 * 60_000;

type Item = { text: string; count: number; first: number; last: number };
type Send = (subject: string, text: string) => Promise<void>;

const clock = (ms: number) => new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export class SecurityAlerts {
  private items = new Map<string, Item>();
  private lastSent = -Infinity;
  private timer: NodeJS.Timeout | null = null;
  constructor(private send: Send, private now = () => Date.now()) {}

  /** `key` groups repeats of the same thing (e.g. one address's worm uploads) into one counted line */
  event(key: string, text: string) {
    const t = this.now();
    const it = this.items.get(key);
    if (it) { it.count++; it.last = t; } else this.items.set(key, { text, count: 1, first: t, last: t });
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), Math.max(0, this.lastSent + MIN_GAP_MS - t));
  }

  async flush() {
    this.timer = null;
    if (!this.items.size) return;
    const items = [...this.items.values()];
    this.items.clear();
    this.lastSent = this.now();
    const lines = items.map((i) => `• ${i.text}` + (i.count > 1 ? ` — ${i.count} times, ${clock(i.first)} to ${clock(i.last)}` : ` — ${clock(i.first)}`));
    const breach = items.some((i) => i.text.startsWith("Logged in with the correct"));
    const subject = breach ? "CallFlow SECURITY: someone outside is using the recording FTP login" : "CallFlow security: FTP login guessing blocked";
    const text = `The CallFlow recording server (FTP) saw:\n\n${lines.join("\n")}\n\n` + (breach
      ? "Someone has the correct FTP username and password. Change the FTP login on the server and in both KoreCall boxes, and scan the office PCs for viruses. Files that aren't recordings are deleted on arrival and never reach CallFlow."
      : "These addresses guessed the FTP login wrongly 10 times and are locked out for 1 hour. Nothing to do unless it is one of the offices.");
    try {
      await this.send(subject, text);
      console.log(`📧 Security email sent: ${items.length} item(s)`);
    } catch (e) {
      console.error(`Security email failed: ${(e as Error).message}`);
    }
  }
}

/** Resend over HTTPS, same account as the API's report emails */
export const resendSend: Send = async (subject, text) => {
  const to = (process.env.SECURITY_ALERT_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const key = process.env.RESEND_API_KEY;
  if (!to.length || !key) { console.warn(`(no SECURITY_ALERT_TO / RESEND_API_KEY: not mailed) ${subject}`); return; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.REPORT_MAIL_FROM || "CallFlow <onboarding@resend.dev>", to, subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
};
