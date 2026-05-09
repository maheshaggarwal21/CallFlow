import "dotenv/config"; // must be first — loads env before any module initialises OpenAI/Redis clients
import { aiQueue } from "./aiQueue";
import { processAiJob } from "../services/ai.service";
import pool from "../db/pool";

// On startup, re-enqueue any jobs that are 'queued' in the DB but absent from Redis.
// This happens when Redis restarts or the worker crashes mid-flight.
async function drainOrphanedJobs() {
  try {
    const res = await pool.query(
      "SELECT call_id FROM ai_jobs WHERE status = 'queued'"
    );
    if (res.rows.length === 0) return;
    console.log(`[drain] Re-enqueuing ${res.rows.length} orphaned job(s)`);
    for (const row of res.rows) {
      await aiQueue.add({ callId: row.call_id });
    }
  } catch (err) {
    console.error("[drain] Failed to re-enqueue orphaned jobs:", err);
  }
}

aiQueue.process(3, async (job) => {
  const callId = job.data?.callId as string | undefined;
  if (!callId) {
    throw new Error("Missing callId");
  }
  await processAiJob(callId);
});

aiQueue.on("failed", (job, err) => {
  console.error("AI job failed", job?.id, err);
});

console.log("AI worker started");
drainOrphanedJobs();
