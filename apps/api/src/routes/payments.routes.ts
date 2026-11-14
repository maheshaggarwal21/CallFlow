import { Router } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import { istDateKey } from "../lib/dateRange";
import { paymentsConfigured, paymentsFor, PaymentsError, type Payment } from "../services/payments.service";

// Payments tab (client, 14 Nov 2026): the school site's payments, read only. The school site answers one rep
// at a time, so this asks for each active person and merges. A User sees only their own; Admins and the
// Super Admin see everyone (the usual rank rule). Student email and phone leave this server only here.
const router = Router();
router.use(requireAuth, requirePermission("payments"));

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const bad = (res: any, status: number, message: string) => res.status(status).json({ error: message, message });

router.get("/", async (req, res) => {
  const today = istDateKey(new Date());
  const from = typeof req.query.from === "string" ? req.query.from : `${today.slice(0, 8)}01`;
  const to = typeof req.query.to === "string" ? req.query.to : today;
  if (!DAY.test(from) || !DAY.test(to) || from > to) return bad(res, 400, "Pick a start date on or before the end date");
  // the school site gives at most 2,000 payments per rep per query; a year keeps well inside that
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) return bad(res, 400, "Pick a period of one year or less");

  const me = req.user!;
  const { rows: people } = await pool.query<{ id: string; name: string }>(
    me.role === "employee"
      ? "SELECT id, name FROM employees WHERE id = $1"
      : "SELECT id, name FROM employees WHERE status = 'active' ORDER BY name",
    me.role === "employee" ? [me.sub] : []);

  const connected = paymentsConfigured();
  const byId = new Map<string, Payment & { rep: string }>();
  const missing: { name: string; error: string }[] = [];
  if (connected) {
    // a few people at a time, so a large team doesn't flood the school's server
    for (let i = 0; i < people.length; i += 4) {
      await Promise.all(people.slice(i, i + 4).map(async (e) => {
        try {
          for (const p of await paymentsFor(e.id, from, to)) byId.set(p.id, { ...p, rep: p.representativeName || e.name });
        } catch (err) {
          if (!(err instanceof PaymentsError)) throw err;
          missing.push({ name: e.name, error: err.message });
        }
      }));
    }
  }
  const payments = [...byId.values()]
    .sort((a, b) => (a.paidDate < b.paidDate ? 1 : a.paidDate > b.paidDate ? -1 : 0))
    .map((p) => ({
      id: p.id, name: p.name, linked_to: p.linkedTo, email: p.email, phone: p.phone, amount: p.amountPaise / 100,
      paid_date: p.paidDate, mode: p.paymentMode, rep: p.rep, fee_type: p.feeType, receipt_url: p.receiptUrl,
    }));
  return res.json({ from, to, connected, payments, missing: missing.sort((a, b) => a.name.localeCompare(b.name)) });
});

export default router;
