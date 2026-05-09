"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { C } from "@/lib/colors";
import { fetcher } from "@/lib/api";
import CallFilters, { CallFilterState, buildSourceParams } from "@/components/calls/CallFilters";
import CallTable from "@/components/calls/CallTable";
import CallPanel from "@/components/calls/CallPanel";
import type { Call, Paginated } from "@callflow/shared-types";

const PAGE_SIZE = 25;

function buildQuery(filters: CallFilterState, page: number): string {
  const p = new URLSearchParams();
  p.set("limit",  String(PAGE_SIZE));
  p.set("offset", String((page - 1) * PAGE_SIZE));
  if (filters.search)     p.set("phone",       filters.search);
  if (filters.direction)  p.set("direction",   filters.direction);
  if (filters.employeeId) p.set("employee_id", filters.employeeId);
  if (filters.dateFrom)   p.set("date_from",   filters.dateFrom);
  if (filters.dateTo)     p.set("date_to",     filters.dateTo);
  if (filters.line)       p.set("line",      filters.line);
  if (filters.intercom)   p.set("intercom",  filters.intercom);
  const src = buildSourceParams(filters.source);
  if (src.source)         p.set("source",    src.source);
  if (src.device_id)      p.set("device_id", src.device_id);
  return `/calls?${p.toString()}`;
}

const EMPTY_FILTERS: CallFilterState = {
  search: "", direction: "", employeeId: "", dateFrom: "", dateTo: "", line: "", intercom: "", source: "",
};

export default function RecordingsPage() {
  const [filters, setFilters]       = useState<CallFilterState>(EMPTY_FILTERS);
  const [page, setPage]             = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = buildQuery(filters, page);
  const { data, isLoading } = useSWR<Paginated<Call>>(query, fetcher, { keepPreviousData: true });

  const handleFilterChange = useCallback((partial: Partial<CallFilterState>) => {
    setFilters((f) => ({ ...f, ...partial }));
    setPage(1);
  }, []);

  const handleSelect = useCallback((call: Call) => {
    setSelectedId((id) => (id === call.id ? null : call.id));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Page header */}
      <div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Recordings</h1>
        <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted }}>
          Browse, play and review · search any caller by number
        </p>
      </div>

      {/* Filters */}
      <CallFilters filters={filters} onChange={handleFilterChange} />

      {/* Table */}
      {isLoading && !data ? (
        <div style={{ padding: 48, textAlign: "center", color: C.muted, fontSize: 14 }}>
          Loading…
        </div>
      ) : (
        <CallTable
          calls={data?.data ?? []}
          total={data?.total ?? 0}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onSelect={handleSelect}
          selectedId={selectedId ?? undefined}
        />
      )}

      {/* Detail panel */}
      <CallPanel
        callId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
