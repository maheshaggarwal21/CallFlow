"use client";

// The dashboard frame: sidebar, top bar and page. On a phone (≤ 900 px) the sidebar slides in from the left behind a
// ☰ button in the top bar and closes on any navigation (client, 15 Nov 2026: "make the site mobile responsive").
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import IdleLogout from "@/components/layout/IdleLogout";

export default function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <Sidebar open={open} />
      {open && <div className="cf-backdrop" onClick={() => setOpen(false)} aria-hidden />}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar onMenu={() => setOpen(true)} />
        <main className="cf-main">{children}</main>
        <IdleLogout />
      </div>
    </>
  );
}
