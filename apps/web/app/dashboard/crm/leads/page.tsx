"use client";

// All Leads (owner or export_leads): every lead in one sortable table, with CSV export.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { R } from "@/components/report/kit";
import Pagination from "@/components/ui/Pagination";
import { api, fetcher } from "@/lib/api";
import { CODES, STATUS_LABEL, type LeadRow } from "@/lib/crm";
import { useAuth } from "@/hooks/useAuth";
import { useCrmMe } from "@/hooks/useCrmMe";
import { Btn, CRM_CSS, HeaderBand, inputStyle } from "@/components/crm/kit";
import LeadTable, { useInlinePlayer, type SortState } from "@/components/crm/LeadTable";
import LeadDrawer from "@/components/crm/LeadDrawer";

const PAGE = 50;

export default function AllLeadsPage() {
  const { isOwner, id: meId } = useAuth();
  const { can, loaded } = useCrmMe();
  const [q, setQ] = useState("");
  const [f, setF] = useState({ q: "", status: "", code: "", date: "" });
  const [sort, setSort] = useState<SortState>({ sort: "created_at", dir: "desc" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const player = useInlinePlayer();

  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q })), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [f, sort]);

  const params = new URLSearchParams(Object.entries({ ...f, ...sort }).filter(([, v]) => v) as [string, string][]);
  const allowed = can("export_leads");
  const { data, mutate } = useSWR<{ data: LeadRow[]; total: number }>(
    allowed ? `/crm/leads?${params}&limit=${PAGE}&offset=${(page - 1) * PAGE}` : null, fetcher, { refreshInterval: 30_000 });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const url = URL.createObjectURL(await api.getBlob(`/crm/leads/export.csv?${params}`));
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (loaded && !allowed) return <p style={{ color: R.mute, padding: 8 }}>All Leads needs the "Export leads" permission. Ask the owner.</p>;
  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gap: 14 }}>
      <style>{CRM_CSS}</style>
      <HeaderBand eyebrow="CRM" title="All Leads" sub={data ? `${data.total} leads match` : "Loading…"}
        right={<Btn kind="light" onClick={exportCsv} disabled={exporting || !data}>{exporting ? "Exporting…" : "⇩ Export CSV"}</Btn>} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or lead ID…" aria-label="Search leads" style={{ ...inputStyle, flex: "2 1 240px", width: "auto" }} />
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status" style={{ ...inputStyle, flex: "1 1 130px", width: "auto" }}>
          <option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-label="Code" style={{ ...inputStyle, flex: "1 1 130px", width: "auto" }}>
          <option value="">All codes</option>{CODES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
        </select>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Lead date" style={{ ...inputStyle, flex: "0 1 150px", width: "auto" }} />
      </div>
      <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "12px 14px" }}>
        {!data ? <p style={{ color: R.mute }}>Loading…</p> : <>
          <LeadTable rows={data.data} onOpen={setOpen} player={player} now={Date.now()} meId={meId} sort={sort} onSort={setSort} />
          <div style={{ marginTop: 10 }}><Pagination page={page} totalPages={Math.ceil(data.total / PAGE)} onPageChange={setPage} /></div>
        </>}
      </section>
      <LeadDrawer leadId={open} isOwner={isOwner} onClose={() => { setOpen(null); mutate(); }} onSaved={() => mutate()} />
    </div>
  );
}
