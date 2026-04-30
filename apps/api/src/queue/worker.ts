import dotenv from "dotenv";
import { aiQueue } from "./aiQueue";
import { processAiJob } from "../services/ai.service";

dotenv.config();

aiQueue.process(async (job) => {
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
