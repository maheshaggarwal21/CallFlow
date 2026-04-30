"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "@/lib/constants";
import type { EmployeeName } from "@callflow/shared-types";

type CallType = "all" | "inbound" | "outbound";

type Props = {
  employees: EmployeeName[];
  employeeId: string;
  callType: CallType;
  onEmployeeChange: (id: string) => void;
  onCallTypeChange: (type: CallType) => void;
  onClear?: () => void;
};

export default function EmployeeFilterDropdown({
  employees,
  employeeId,
  callType,
  onEmployeeChange,
  onCallTypeChange,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const label = useMemo(() => {
    const parts: string[] = [];
    if (employeeId !== "all") {
      const emp = employees.find((e) => e.id === employeeId);
      parts.push(emp?.name ?? "Selected agent");
    }
    if (callType === "inbound") parts.push("Inbound");
    if (callType === "outbound") parts.push("Outbound");
    return parts.length === 0 ? "All calls" : parts.join(" | ");
  }, [employeeId, callType, employees]);

  const hasFilters = employeeId !== "all" || callType !== "all";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 16px",
          borderRadius: 20,
          border: `1px solid ${hasFilters ? C.orangeBdr : C.border}`,
          background: hasFilters ? C.orangeLight : "transparent",
          color: hasFilters ? C.orange : C.textSub,
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 600,
          transition: "all 0.15s",
        }}
      >
        <span style={{ fontSize: 12, color: "inherit" }}>Filter</span>
        {label}
        <span style={{ fontSize: 10, color: "inherit", opacity: 0.7 }}>{open ? "^" : "v"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 50,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            boxShadow: C.shadowMd,
            minWidth: 240,
            padding: "8px 0",
            overflow: "hidden",
          }}
        >
          <p
            style={{
              margin: "8px 16px 4px",
              fontSize: 10,
              color: C.muted,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Agent
          </p>
          <button
            onClick={() => {
              onEmployeeChange("all");
              setOpen(false);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "9px 16px",
              background: employeeId === "all" ? C.orangeLight : "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              transition: "background 0.12s",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: employeeId === "all" ? 700 : 500, color: employeeId === "all" ? C.orange : C.text }}>
              All Agents
            </span>
            {employeeId === "all" && <span style={{ fontSize: 12, color: C.orange }}>*</span>}
          </button>
          {employees.map((emp) => {
            const isChosen = employeeId === emp.id;
            return (
              <button
                key={emp.id}
                onClick={() => {
                  onEmployeeChange(emp.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "9px 16px",
                  background: isChosen ? C.orangeLight : "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.12s",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: isChosen ? 700 : 500, color: isChosen ? C.orange : C.text }}>
                  {emp.name}
                </span>
                {isChosen && <span style={{ fontSize: 12, color: C.orange }}>*</span>}
              </button>
            );
          })}

          <div style={{ height: 1, background: C.borderLight, margin: "6px 0" }} />

          <p
            style={{
              margin: "4px 16px 4px",
              fontSize: 10,
              color: C.muted,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Call Type
          </p>
          {[
            { label: "All Types", value: "all" as CallType },
            { label: "Inbound", value: "inbound" as CallType },
            { label: "Outbound", value: "outbound" as CallType },
          ].map((opt) => {
            const isChosen = callType === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => {
                  onCallTypeChange(opt.value);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "9px 16px",
                  background: isChosen ? C.orangeLight : "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.12s",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: isChosen ? 700 : 500, color: isChosen ? C.orange : C.text }}>
                  {opt.label}
                </span>
                {isChosen && <span style={{ fontSize: 12, color: C.orange }}>*</span>}
              </button>
            );
          })}

          {hasFilters && (
            <>
              <div style={{ height: 1, background: C.borderLight, margin: "6px 0" }} />
              <button
                onClick={() => {
                  onClear?.();
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  padding: "9px 16px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                  color: C.red,
                  fontWeight: 600,
                }}
              >
                Clear all filters
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
