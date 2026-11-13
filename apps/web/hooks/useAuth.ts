"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { AuthUser } from "@callflow/shared-types";

/**
 * The signed-in account. isOwner = Super Admin. isUser = the "User" rank, which only sees its own
 * data. can(key) = may open that tab (Users → Tabs); the Super Admin can open all of them.
 */
export function useAuth(): AuthUser & { isOwner: boolean; isUser: boolean; isLoading: boolean; can: (key: string) => boolean } {
  const { data, isLoading } = useSWR<AuthUser>("/auth/me", fetcher);

  return {
    id:          data?.id ?? "",
    name:        data?.name ?? "",
    email:       data?.email ?? "",
    role:        data?.role ?? "employee",
    color_index: data?.color_index ?? 0,
    permissions: data?.permissions ?? [],
    isOwner:     data?.role === "owner",
    isUser:      !data || data.role === "employee",
    isLoading,
    can:         (key) => !!data && (data.role === "owner" || !!data.permissions?.includes(key)),
  };
}
