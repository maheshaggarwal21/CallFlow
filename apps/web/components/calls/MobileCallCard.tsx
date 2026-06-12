"use client";

import { C, eClr, init, fmtS } from "@/lib/colors";
import { fmtTime, fmtDate } from "@/lib/datetime";
import { getStudentDisplay } from "@/lib/studentLabel";
import type { Call } from "@callflow/shared-types";

interface Props {
  call: Call;
  onMore?: (call: Call) => void;
    isLast?: boolean;
}

export default function MobileCallCard({ call, onMore, isLast = false }: Props) {
  const isIn = call.call_direction === "inbound";
  const empClr = call.color_index !== null ? eClr(call.color_index) : null;
  const sd = getStudentDisplay(call.caller_phone, call.student_name);
  const dt = new Date(call.called_at);

  const lineLabel = call.line_number ? call.line_number.replace(/^Line\s*/i, "") : "-";
  const icLabel = call.intercom_code ? call.intercom_code.replace(/^IC-?/i, "") : "";
  const icPhone = call.intercom_phone_number ? ` / ${call.intercom_phone_number}` : "";

  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: isLast ? "none" : `1px solid ${C.borderLight}`,
        transition: "background 0.12s",
      }}
      onClick={() => onMore?.(call)}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: isIn ? C.green : C.orange,
              background: isIn ? C.greenLight : C.orangeLight,
              border: `1px solid ${isIn ? C.greenBdr : C.orangeBdr}`,
              borderRadius: 20,
              padding: "3px 10px",
            }}
          >
            {isIn ? "In" : "Out"}
          </span>
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: -0.2, display: "block" }}>
              {call.caller_phone === "Unknown" || !call.caller_phone ? "Unknown" : call.caller_phone}
            </span>
            {!sd.isUnknown && (
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>
                {sd.isNew ? "New" : sd.label}
              </span>
            )}
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textSub }}>{fmtS(call.duration_secs)}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {empClr && call.employee_name ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  flexShrink: 0,
                  background: empClr.bg,
                  border: `1px solid ${empClr.br}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 800,
                  color: empClr.t,
                }}
              >
                {init(call.employee_name)}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: empClr.t }}>{call.employee_name}</span>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: C.dim }}>-</span>
          )}

          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: C.blue,
              background: C.blueLight,
              border: `1px solid ${C.blueBdr}`,
              borderRadius: 14,
              padding: "2px 8px",
            }}
          >
            {lineLabel}
          </span>

          {call.intercom_code && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: C.teal,
                background: C.tealLight,
                border: `1px solid ${C.tealBdr}`,
                borderRadius: 14,
                padding: "2px 8px",
              }}
            >
              IC {icLabel}{icPhone}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.muted }}>
            {fmtTime(dt)} | {fmtDate(dt)}
          </span>
          
          <span style={{ fontSize: 14, color: C.dim }}>{">"}</span>
        </div>
      </div>
    </div>
  );
}
