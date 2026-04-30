"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { AuthUser } from "@callflow/shared-types";

export function useAuth(): AuthUser & { isOwner: boolean; isLoading: boolean } {
  const { data, isLoading } = useSWR<AuthUser>("/auth/me", fetcher);

  return {
    id:          data?.id ?? "",
    name:        data?.name ?? "",
    email:       data?.email ?? "",
    role:        data?.role ?? "employee",
    color_index: data?.color_index ?? 0,
    isOwner:     data?.role === "owner",
    isLoading,
  };
}
