// A stand-in for the school site's partner payments API, for local tests only (shape copied from the
// developer's sample, 13 Nov 2026). Every rep gets the same November 2026 payments:
//   03 Nov Trial ₹500 · 05 Nov Monthly ₹2,999.50 (bad receipt link) · 10 Nov Monthly ₹4,000 (https receipt)
//   20 Nov 102 × Monthly ₹10 (so a month spans two pages of 100)
// Key: "mock-key". A callFlowId in `broken` gets a malformed answer.
import http from "node:http";

export const MOCK_KEY = "mock-key";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pay = (id, paidDate, amountPaise, feeType, receiptUrl = null) => ({
  id, name: `Student ${id}`, email: "", phone: "9000000000", amount: (amountPaise / 100).toFixed(2), amountPaise, currency: "INR",
  paidDate, paidDateDisplay: paidDate, paymentMode: "Cash", feeType, representativeName: "Rep", linkedTo: "student",
  hasReceipt: !!receiptUrl, receiptUrl, createdAt: `${paidDate}T10:00:00.000Z`, updatedAt: `${paidDate}T10:00:00.000Z`,
});
const ALL = [
  pay("p1", "2026-11-03", 50_000, "Trial"),
  pay("p2", "2026-11-05", 299_950, "Monthly", "javascript:alert(1)"),
  pay("p3", "2026-11-10", 400_000, "Monthly", "https://example.com/receipt.jpg"),
  ...Array.from({ length: 102 }, (_, i) => pay(`q${i}`, "2026-11-20", 1_000, "Monthly")),
];

export function startMock(port = 4100) {
  const broken = new Set();
  const server = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname !== "/api/v1/partner/payments") return send(404, { message: "Not found" });
    if (req.headers["x-api-key"] !== MOCK_KEY) return send(401, { message: "Bad key" });
    const q = Object.fromEntries(u.searchParams);
    if (!UUID.test(q.callFlowId ?? "")) return send(400, { message: "callFlowId must be a UUID" });
    if (broken.has(q.callFlowId)) return send(200, { data: { payments: "oops" } });
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const list = ALL.filter((p) => (!q.startDate || p.paidDate >= q.startDate) && (!q.endDate || p.paidDate <= q.endDate));
    send(200, { code: 200, message: "Payments fetched.", data: {
      user: { callFlowId: q.callFlowId, name: "Rep", status: "Active" }, filters: { startDate: q.startDate, endDate: q.endDate },
      payments: list.slice((page - 1) * limit, page * limit),
      pagination: { total: list.length, page, limit, pages: Math.ceil(list.length / limit) },
      totalAmountPaise: list.reduce((t, p) => t + p.amountPaise, 0), receiptUrlExpiresInSeconds: 1800,
    } });
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ server, broken })));
}
