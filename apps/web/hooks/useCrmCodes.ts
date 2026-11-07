"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { CRM_ENABLED, codeList, statusLabel, type Code, type CrmConfig } from "@/lib/crm";

/** The status codes as set in CRM Settings (shares the /crm/config fetch with the lead form). */
export function useCrmCodes() {
  const { data } = useSWR<CrmConfig>(CRM_ENABLED ? "/crm/config" : null, fetcher);
  const list = useMemo(() => codeList(data?.codes), [data]);
  const meta = (c: string | null | undefined) => list.find((x) => x.code === c);
  const label = (l: { status: string; current_code: Code | null }) => statusLabel(l, meta(l.current_code));
  /** Codes the rep can pick: everything not marked "Not used". */
  const inUse = list.filter((c) => c.kind !== "unused");
  return { list, inUse, meta, label };
}
