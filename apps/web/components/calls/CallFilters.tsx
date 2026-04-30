"use client";

import { C } from "@/lib/colors";
import { useAuth } from "@/hooks/useAuth";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { EmployeeName, Line, Intercom, DeviceName } from "@callflow/shared-types";

export interface CallFilterState {
  search:     string;
  direction:  "inbound" | "outbound" | "";
  employeeId: string;
  dateFrom:   string;
  dateTo:     string;
  line:       string;
  intercom:   string;
  source:     string;   // "korecall" | device UUID | ""
}

interface Props {
  filters: CallFilterState;
  onChange: (f: Partial<CallFilterState>) => void;
  showAgent?: boolean;
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  fontSize: 13,
  color: C.text,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700,
  color: C.muted, textTransform: "uppercase",
  letterSpacing: 0.8, marginBottom: 4, display: "block",
};

export function buildSourceParams(source: string): { source?: string; device_id?: string } {
  if (!source) return {};
  if (source === "korecall") return { source: "korecall" };
  return { source: "android_app", device_id: source };
}

export default function CallFilters({ filters, onChange, showAgent = true }: Props) {
  const { isOwner } = useAuth();
  const { data: employees } = useSWR<EmployeeName[]>(isOwner ? "/employees/names" : null, fetcher);
  const { data: lines }     = useSWR<Line[]>("/lines", fetcher);
  const { data: intercoms } = useSWR<Intercom[]>("/intercoms", fetcher);
  const { data: devices }   = useSWR<DeviceName[]>("/devices/names", fetcher);

  const hasFilter = filters.search || filters.direction || filters.employeeId ||
                    filters.dateFrom || filters.dateTo || filters.line || filters.intercom || filters.source;
  const showAgentFilter = isOwner && showAgent;

  return (
    <div style={{
      display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap",
      padding: "16px 20px",
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
    }}>

      {/* Phone */}
      <div style={{ flex: "1 1 200px" }}>
        <label style={labelStyle}>Phone</label>
        <input
          type="text"
          placeholder="Phone…"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
        />
      </div>

      {/* Date from */}
      <div>
        <label style={labelStyle}>From</label>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ dateFrom: e.target.value })}
          style={inputStyle}
        />
      </div>

      {/* Date to */}
      <div>
        <label style={labelStyle}>To</label>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ dateTo: e.target.value })}
          style={inputStyle}
        />
      </div>

      {/* Type */}
      <div>
        <label style={labelStyle}>Type</label>
        <select
          value={filters.direction}
          onChange={(e) => onChange({ direction: e.target.value as CallFilterState["direction"] })}
          style={inputStyle}
        >
          <option value="">All</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
      </div>

      {/* Line */}
      <div>
        <label style={labelStyle}>Line</label>
        <select
          value={filters.line}
          onChange={(e) => onChange({ line: e.target.value })}
          style={inputStyle}
        >
          <option value="">All Lines</option>
          {(lines ?? []).map((l) => (
            <option key={l.id} value={l.line_number}>{l.line_number}</option>
          ))}
        </select>
      </div>

      {/* Intercom */}
      <div>
        <label style={labelStyle}>Intercom</label>
        <select
          value={filters.intercom}
          onChange={(e) => onChange({ intercom: e.target.value })}
          style={inputStyle}
        >
          <option value="">All ICs</option>
          {(intercoms ?? []).map((ic) => (
            <option key={ic.id} value={ic.intercom_code}>{ic.intercom_code}</option>
          ))}
        </select>
      </div>

      {/* Source */}
      <div>
        <label style={labelStyle}>Source</label>
        <select
          value={filters.source}
          onChange={(e) => onChange({ source: e.target.value })}
          style={inputStyle}
        >
          <option value="">All sources</option>
          <option value="korecall">KoreCall</option>
          {(devices ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.device_name}</option>
          ))}
        </select>
      </div>

      {/* Agent — owner only */}
      {showAgentFilter && (
        <div>
          <label style={labelStyle}>Agent</label>
          <select
            value={filters.employeeId}
            onChange={(e) => onChange({ employeeId: e.target.value })}
            style={inputStyle}
          >
            <option value="">All agents</option>
            {(employees ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Clear */}
      {hasFilter && (
        <button
          onClick={() => onChange({ search: "", direction: "", employeeId: "", dateFrom: "", dateTo: "", line: "", intercom: "", source: "" })}
          style={{
            padding: "8px 14px",
            border: `1px solid ${C.border}`,
            borderRadius: 10, background: C.bgDeep,
            color: C.muted, fontSize: 13, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
