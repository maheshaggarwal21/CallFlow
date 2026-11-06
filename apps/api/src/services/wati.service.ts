import { randomUUID } from "crypto";

/**
 * WhatsApp template sends through WATI. MOCK MODE whenever WATI_API_URL or
 * WATI_TOKEN is unset: nothing leaves the server, the send is only logged.
 * shortcut: live mode follows WATI's documented sendTemplateMessage call but has
 * never run against a real account; verify it once credentials arrive.
 */
export const watiMode = (): "live" | "mock" =>
  process.env.WATI_API_URL && process.env.WATI_TOKEN ? "live" : "mock";

/** `{name}`-style substitution; unknown variables stay visible so a typo shows in the preview. */
export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ? vars[k] : m));
}

export const templateVars = (body: string) => [...new Set([...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

export async function sendWhatsAppTemplate(m: { phone10: string; template: string; body: string; vars: Record<string, string> }) {
  if (watiMode() === "mock") {
    console.log(`[wati:mock] → 91${m.phone10} template=${m.template}\n${fillTemplate(m.body, m.vars)}\n`);
    return { mode: "mock" as const, message_id: `mock-${randomUUID()}` };
  }
  const url = `${process.env.WATI_API_URL!.replace(/\/$/, "")}/api/v1/sendTemplateMessage?whatsappNumber=91${m.phone10}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WATI_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      template_name: m.template,
      broadcast_name: `crm_${m.template}`,
      parameters: templateVars(m.body).map((name) => ({ name, value: m.vars[name] ?? "" })),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`WATI ${res.status}: ${text.slice(0, 200)}`);
  return { mode: "live" as const, message_id: text.slice(0, 100) };
}
