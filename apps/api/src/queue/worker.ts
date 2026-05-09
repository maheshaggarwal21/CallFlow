import "dotenv/config"; // must be first — loads env before any module initialises OpenAI/Redis clients
import { aiQueue } from "./aiQueue";
import { processAiJob } from "../services/ai.service";

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
