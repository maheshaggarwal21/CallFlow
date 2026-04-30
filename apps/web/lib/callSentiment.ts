import type { Call, Sentiment } from "@callflow/shared-types";
import { C } from "./constants";

export type SentimentResult = {
  e: string;
  label: string;
  color: string;
};

const MAP: Record<Exclude<Sentiment, null>, SentimentResult> = {
  positive: { e: "😊", label: "Positive", color: C.green },
  neutral:  { e: "😐", label: "Neutral",  color: C.orange },
  negative: { e: "😞", label: "Negative", color: C.red },
};

const PENDING: SentimentResult = { e: "⏳", label: "Pending", color: C.muted };
const UNKNOWN: SentimentResult = { e: "—", label: "Unknown", color: C.dim };

export function callSentiment(
  call: Pick<Call, "ai_status" | "sentiment"> | null
): SentimentResult {
  if (call?.ai_status === "done" && call.sentiment) {
    return MAP[call.sentiment] ?? UNKNOWN;
  }
  if (call?.ai_status === "pending" || call?.ai_status === "processing") {
    return PENDING;
  }
  return UNKNOWN;
}
