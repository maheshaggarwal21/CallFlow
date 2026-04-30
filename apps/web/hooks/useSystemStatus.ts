"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { SystemStatus } from "@callflow/shared-types";

export function useSystemStatus() {
  const { data } = useSWR<SystemStatus>(
    "/system/status",
    fetcher,
    { refreshInterval: 30_000 }
  );

  const ftp = data?.ftp_last_sync_at ?? null;
  const android = data?.android_last_sync_at ?? null;
  const aiPending = data?.ai_queue_pending ?? 0;

  function syncLabel(): string {
    if (!ftp && !android) return "Idle";
    const now = Date.now();
    const ftpAge = ftp ? now - new Date(ftp).getTime() : Infinity;
    const androidAge = android ? now - new Date(android).getTime() : Infinity;
    const recentThreshold = 20 * 60 * 1000; // 20 minutes
    if (ftpAge < recentThreshold) return "FTP sync active";
    if (androidAge < recentThreshold) return "Phone sync active";
    return "Idle";
  }

  return {
    ftp,
    android,
    aiPending,
    syncLabel: syncLabel(),
    isLive: !!(ftp || android),
  };
}
