import "dotenv/config"; // must be first — loads env before any module initialises OpenAI/Redis clients
import { aiQueue } from "./aiQueue";
import { processAiJob } from "../services/ai.service";
import pool from "../db/pool";

// Jobs stuck in 'processing' longer than this are assumed dead (worker crash mid-job).
const STALE_PROCESSING_MINUTES = 15;

async function drainOrphanedJobs() {
  try {
    // Step 1: reset jobs that got stuck in 'processing' (worker crashed mid-flight).
    // Bull's stall detection fires after lockDuration, but if the process was killed
    // hard or the stall count was exhausted, the job disappears from Redis while the
    // DB row stays 'processing' forever. We reset those back to 'queued' so the
    // normal path below picks them up.
    const stuckRes = await pool.query(
      `SELECT call_id FROM ai_jobs
       WHERE status = 'processing'
         AND started_at < NOW() - INTERVAL '${STALE_PROCESSING_MINUTES} minutes'`
    );

    if (stuckRes.rows.length > 0) {
      console.log(`[drain] Resetting ${stuckRes.rows.length} stuck-processing job(s)`);
      await pool.query(
        `UPDATE ai_jobs
         SET status = 'queued', started_at = NULL, error_msg = 'Reset: stuck in processing'
         WHERE status = 'processing'
           AND started_at < NOW() - INTERVAL '${STALE_PROCESSING_MINUTES} minutes'`
      );
    }

    // Step 2: re-enqueue all 'queued' rows whose Bull job is missing from Redis.
    // Using jobId = 'call-<uuid>' ensures Bull deduplicates: if the job is already
    // waiting in Redis (Redis persisted it across a worker restart), Bull skips the
    // add instead of creating a duplicate.
    const res = await pool.query(
      "SELECT call_id FROM ai_jobs WHERE status = 'queued'"
    );
    if (res.rows.length === 0) return;

    console.log(`[drain] Re-enqueuing ${res.rows.length} orphaned job(s)`);
    for (const row of res.rows) {
      await aiQueue.add(
        { callId: row.call_id },
        { jobId: `call-${row.call_id}` }
      );
    }
  } catch (err) {
    console.error("[drain] Failed to re-enqueue orphaned jobs:", err);
  }
}

aiQueue.process(3, async (job) => {
  const callId = job.data?.callId as string | undefined;
  if (!callId) throw new Error("Missing callId");
  await processAiJob(callId);
});

aiQueue.on("failed", (job, err) => {
  console.error(`[worker] AI job failed bull_id=${job?.id} call_id=${job?.data?.callId}`, err?.message);
});

aiQueue.on("stalled", (job) => {
  console.warn(`[worker] AI job stalled bull_id=${job?.id} call_id=${job?.data?.callId} — will be re-queued by Bull`);
});

console.log("AI worker started");

// Run immediately on startup to recover any jobs lost during the restart.
drainOrphanedJobs();

// Run periodically so newly stuck jobs are caught without requiring a restart.
setInterval(drainOrphanedJobs, 5 * 60 * 1000);
