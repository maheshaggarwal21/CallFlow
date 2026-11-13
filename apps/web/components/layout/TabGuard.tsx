"use client";

// Shows a page only when its tab is ticked for the signed-in user. The API checks the same
// permission on every request, so this is for a clean message, not for security.
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { C } from "@/lib/colors";
import { useAuth } from "@/hooks/useAuth";
import { tabOf } from "@/lib/tabs";

export default function TabGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isLoading, id, can } = useAuth();
  const tab = tabOf(pathname);
  if (!tab) return <>{children}</>;
  if (isLoading || !id) return <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>;
  if (can(tab.key)) return <>{children}</>;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", maxWidth: 560 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>No access to {tab.label}</h3>
      <p style={{ margin: "6px 0 0", fontSize: 14, color: C.muted }}>Ask the Super Admin to tick “{tab.label}” for you on the Users tab.</p>
    </div>
  );
}
