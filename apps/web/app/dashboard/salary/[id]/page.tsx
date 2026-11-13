"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/colors";
import { useAuth } from "@/hooks/useAuth";
import { HOME } from "@/lib/tabs";
import UserDashboard from "@/components/users/UserDashboard";

/** The Super Admin's eye on one employee: their dashboard as they see it (Employee Tracker → View). */
export default function EmployeeSalaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { id: myId, isOwner, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!isLoading && myId && !isOwner) router.replace(HOME); }, [isLoading, myId, isOwner, router]);
  if (isLoading || !myId || !isOwner) return <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>;
  return <UserDashboard id={id} />;
}
