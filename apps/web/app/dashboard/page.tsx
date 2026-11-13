"use client";

// Landing after sign-in: a User goes to their own dashboard, everyone else to their first tab.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/colors";
import { useAuth } from "@/hooks/useAuth";
import { HOME, TABS } from "@/lib/tabs";

export default function DashboardHome() {
  const router = useRouter();
  const { isLoading, id, isUser, can } = useAuth();
  const first = isUser ? HOME : TABS.find((t) => can(t.key))?.path;
  useEffect(() => { if (!isLoading && id && first) router.replace(first); }, [isLoading, id, first, router]);
  return (
    <p style={{ color: C.muted, fontSize: 14 }}>
      {isLoading || !id || first ? "Loading…" : "No tab has been ticked for your account yet. Ask the Super Admin to tick one on the Users tab."}
    </p>
  );
}
