import type { CallAiStatus } from "@callflow/shared-types";
import { C } from "./constants";

export type TagSpec = {
  label: string;
  color: string;
  bg: string;
};

export function aiStatusTag(status: CallAiStatus): TagSpec {
  switch (status) {
    case "done":
      return { label: "Processed", color: C.green, bg: C.greenLight };
    case "processing":
      return { label: "Processing", color: C.orange, bg: C.orangeLight };
    case "failed":
      return { label: "Failed", color: C.red, bg: C.redLight };
    case "pending":
    default:
      return { label: "Pending", color: C.muted, bg: C.bgDeep };
  }
}
