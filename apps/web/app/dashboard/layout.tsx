import Shell from "@/components/layout/Shell";
import TabGuard from "@/components/layout/TabGuard";
import { C }   from "@/lib/colors";
import { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
      <Shell><TabGuard>{children}</TabGuard></Shell>
    </div>
  );
}
