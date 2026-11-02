// Resend over its HTTPS API with Node's built-in fetch — no SDK dependency.
// Without RESEND_API_KEY: development prints the mail; production refuses, so
// the run is logged as failed instead of silently marked "sent".

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendMail(m: { to: string[]; subject: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set");
    console.log(`[mail:dev] To: ${m.to.join(", ")}\nSubject: ${m.subject}\n\n${m.text}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.REPORT_MAIL_FROM || "CallFlow Reports <onboarding@resend.dev>",
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(m.text)}</div>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}
