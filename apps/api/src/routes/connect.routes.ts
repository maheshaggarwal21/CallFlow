import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { lineOptions, startTest, myState, endMine, seen, ConnectError } from "../services/lineSession.service";

// The test page after employee login (client, 28 Nov 2026; docs/EMPLOYEE-LOGIN-PLAN.md). Every signed-in person may
// use it for themselves; nothing here touches anyone else's line.
const router = Router();
router.use(requireAuth);

router.get("/options", async (req, res) => res.json(await lineOptions(true, req.user!.sub)));

/** polled every few seconds by the test page; also where a running test is matched to its recording */
router.get("/me", async (req, res) => res.json(await myState(req.user!.sub)));

router.post("/start", async (req, res) => {
  const p = z.object({ line_id: z.string().uuid() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Pick a calling number", message: "Pick a calling number" });
  try {
    await startTest(req.user!.sub, p.data.line_id);
  } catch (err) {
    if (!(err instanceof ConnectError)) throw err;
    return res.status(err.status).json({ error: err.message, message: err.message, ...err.extra });
  }
  return res.json(await myState(req.user!.sub));
});

/** activity ping from the dashboard (touched: true), or just a look at the last activity before asking "Are you there?" */
router.post("/seen", async (req, res) => res.json(await seen(req.user!.sub, req.body?.touched === true)));

router.post("/end", async (req, res) => {
  await endMine(req.user!.sub);
  return res.json({ ok: true });
});

export default router;
