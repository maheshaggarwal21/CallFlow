import { Router } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

router.get("/status", async (_req, res) => {
  const stateRes = await pool.query(
    "SELECT ftp_last_sync_at FROM system_state WHERE id = 1"
  );

  const row = stateRes.rows[0] || { ftp_last_sync_at: null };

  return res.json({
    ftp_last_sync_at: row.ftp_last_sync_at,
  });
});

export default router;
