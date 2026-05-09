"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { SystemStatus } from "@callflow/shared-types";

function timeAgo(ts: string): string {
  const diffMs = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? "1 hr ago" : `${hrs} hrs ago`;
}

export function useSystemStatus() {
  const { data } = useSWR<SystemStatus>(
    "/system/status",
    fetcher,
    { refreshInterval: 15_000 }
  );

  const ftp = data?.ftp_last_sync_at ?? null;
  const android = data?.android_last_sync_at ?? null;
  const aiPending = data?.ai_queue_pending ?? 0;

  const now = Date.now();
  const recentThreshold = 20 * 60 * 1000; // 20 minutes
  const ftpAge = ftp ? now - new Date(ftp).getTime() : Infinity;
  const androidAge = android ? now - new Date(android).getTime() : Infinity;
  const isLive = ftpAge < recentThreshold || androidAge < recentThreshold;

  function syncLabel(): string {
    if (ftpAge <= androidAge && ftpAge < recentThreshold && ftp)
      return `FTP · ${timeAgo(ftp)}`;
    if (androidAge < recentThreshold && android)
      return `Phone · ${timeAgo(android)}`;
    if (ftp) return `Last: ${timeAgo(ftp)}`;
    if (android) return `Last: ${timeAgo(android)}`;
    return "No Sync";
  }

  return {
    ftp,
    android,
    aiPending,
    syncLabel: syncLabel(),
    isLive,
  };
}
