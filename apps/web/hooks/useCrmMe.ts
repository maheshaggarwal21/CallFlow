"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { CRM_ENABLED, type CrmMe } from "@/lib/crm";

/** CRM permissions of the signed-in user (owner has all). Null fetch when the CRM is off. */
export function useCrmMe() {
  const { data } = useSWR<CrmMe>(CRM_ENABLED ? "/crm/me" : null, fetcher);
  const can = (p: string) => !!data && (data.is_owner || data.permissions.includes(p));
  return { me: data, can, loaded: !!data };
}
