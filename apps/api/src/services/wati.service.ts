/**
 * WhatsApp through the school's WATI account (client, 12 Nov 2026): the approved templates for the
 * lead form's dropdown, a template send, and a link into WATI's inbox for a number.
 * WATI_DRY_RUN=1 (always set by crmDevEnv for local work) lists the real templates but only logs a send.
 */
const base = () => (process.env.WATI_API_URL ?? "").replace(/\/$/, "");
export const watiConfigured = () => !!(base() && process.env.WATI_TOKEN);
export const watiDryRun = () => process.env.WATI_DRY_RUN === "1";

async function wati(path: string, init?: RequestInit): Promise<any> {
  if (!watiConfigured()) throw new Error("WATI is not set up (WATI_API_URL / WATI_TOKEN)");
  const res = await fetch(base() + path, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.WATI_TOKEN}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WATI ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`WATI sent an unreadable answer: ${text.slice(0, 120)}`); }
}

export type WatiTemplate = {
  name: string; header: string; body: string; footer: string; buttons: string[];
  /** The template's variables in order, each with the sample value saved in WATI. */
  params: { name: string; sample: string }[];
};

let cache: { at: number; list: WatiTemplate[] } | null = null;
/** Approved templates, A→Z. Kept for 10 minutes: the account holds several hundred across pages. */
export async function listTemplates(): Promise<WatiTemplate[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.list;
  // Page 1 says how many there are; the other pages are then fetched together, not one after another
  const PAGE = 100;
  const first = await wati(`/api/v1/getMessageTemplates?pageSize=${PAGE}&pageNumber=1`);
  const pages = Math.min(20, Math.ceil(Number(first.link?.total ?? 0) / PAGE));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
    wati(`/api/v1/getMessageTemplates?pageSize=${PAGE}&pageNumber=${i + 2}`)));
  const list: WatiTemplate[] = [];
  for (const d of [first, ...rest]) {
    for (const t of d.messageTemplates ?? []) {
      if (t.status !== "APPROVED") continue;
      list.push({
        name: t.elementName, header: t.header?.text ?? "", body: t.bodyOriginal ?? t.body ?? "", footer: t.footer ?? "",
        buttons: (t.buttons ?? []).map((b: any) => b.parameter?.text).filter(Boolean),
        params: (t.customParams ?? []).map((p: any) => ({ name: String(p.paramName), sample: String(p.paramValue ?? "") })),
      });
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), list };
  return list;
}

/** `{{name}}` / `{{1}}` filled in; an unknown variable stays visible so a gap shows in the preview. */
export const fillTemplate = (body: string, values: Record<string, string>) =>
  body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => values[k] || m);

export async function sendTemplate(phone10: string, t: WatiTemplate, values: Record<string, string>): Promise<"sent" | "dry-run"> {
  if (watiDryRun()) {
    console.log(`[wati:dry-run] → 91${phone10} template=${t.name}\n${fillTemplate(t.body, values)}\n`);
    return "dry-run";
  }
  const d = await wati(`/api/v1/sendTemplateMessage?whatsappNumber=91${phone10}`, {
    method: "POST",
    body: JSON.stringify({
      template_name: t.name,
      broadcast_name: `callflow_${t.name}`.slice(0, 60),
      parameters: t.params.map((p) => ({ name: p.name, value: values[p.name] ?? "" })),
    }),
  });
  // WATI answers 200 even when it refuses (bad number, template paused): the reason is in `info`
  if (d.result === false) throw new Error(`WATI did not send it: ${String(d.info ?? "no reason given").slice(0, 200)}`);
  return "sent";
}

/**
 * Where "open in WATI" goes: the number's own chat when WATI knows the contact, else the inbox.
 * shortcut: the /teamInbox/<contact id> address is WATI's web app route, not part of their API docs;
 * set WATI_INBOX_URL (e.g. https://live-7375.wati.io/7375/teamInbox) and re-check it if WATI changes its app.
 */
export async function inboxUrl(phone10: string): Promise<string | null> {
  const inbox = (process.env.WATI_INBOX_URL ?? "").replace(/\/$/, "");
  if (!inbox) return null;
  try {
    const filter = encodeURIComponent(JSON.stringify([{ name: "phone", operator: "contain", value: phone10 }]));
    const d = await wati(`/api/v1/getContacts?pageSize=1&pageNumber=1&attribute=${filter}`);
    const id = d.contact_list?.[0]?.id;
    return id ? `${inbox}/${id}` : inbox;
  } catch {
    return inbox;
  }
}
