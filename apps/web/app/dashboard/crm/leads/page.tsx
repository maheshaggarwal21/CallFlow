"use client";

// All Leads (owner or export_leads): every lead in one sortable table, with CSV export.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { R } from "@/components/report/kit";
import Pagination from "@/components/ui/Pagination";
import { api, fetcher } from "@/lib/api";
import { CODES, STATUS_LABEL, type CrmConfig, type LeadRow } from "@/lib/crm";
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
  const [f, setF] = useState({ q: "", status: "", code: "", date: "", assigned: "" });
  const [sort, setSort] = useState<SortState>({ sort: "created_at", dir: "desc" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const player = useInlinePlayer();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [assignMsg, setAssignMsg] = useState("");
  const [assigning, setAssigning] = useState(false);
  const { data: cfg } = useSWR<CrmConfig>("/crm/config", fetcher);

  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q })), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [f, sort]);
  const select = (ids: string[], on: boolean) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const assign = async (employeeId: string | null) => {
    setAssigning(true);
    setAssignMsg("");
    try {
      const r = await api.post<{ updated: number; assigned_to_name: string | null }>("/crm/leads/assign", { lead_ids: [...selected], employee_id: employeeId });
      setAssignMsg(r.assigned_to_name ? `${r.updated} lead${r.updated === 1 ? "" : "s"} assigned to ${r.assigned_to_name}` : `${r.updated} lead${r.updated === 1 ? "" : "s"} moved back to the shared pool`);
      setSelected(new Set());
      mutate();
    } catch (e) {
      setAssignMsg(`! ${(e as Error).message}`);
    } finally {
      setAssigning(false);
    }
  };

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
        <select value={f.assigned} onChange={(e) => setF({ ...f, assigned: e.target.value })} aria-label="Assigned to" style={{ ...inputStyle, flex: "1 1 150px", width: "auto" }}>
          <option value="">Anyone / shared pool</option><option value="none">Unassigned only</option>
          {cfg?.reps.map((r) => <option key={r.id} value={r.id}>Assigned to {r.name}</option>)}
        </select>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Lead date" style={{ ...inputStyle, flex: "0 1 150px", width: "auto" }} />
      </div>
      {can("reassign_leads") && (
        <div role="region" aria-label="Assign selected leads" style={{ position: "sticky", top: 8, zIndex: 5, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
          background: selected.size ? "linear-gradient(135deg,#3b2a1e,#5a4231)" : R.card, color: selected.size ? "#fff" : R.mute,
          border: `1px solid ${selected.size ? "transparent" : R.line}`, borderRadius: 14, padding: "10px 14px", transition: "background .2s" }}>
          <b style={{ fontSize: 14 }}>{selected.size ? `${selected.size} selected` : "Tick leads to assign them to a rep"}</b>
          {selected.size > 0 && <>
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Representative" style={{ ...inputStyle, width: 220 }}>
              <option value="">Choose a representative…</option>
              {cfg?.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Btn onClick={() => assign(assignTo)} disabled={!assignTo || assigning}>{assigning ? "Assigning…" : "Assign"}</Btn>
            <Btn kind="light" onClick={() => assign(null)} disabled={assigning} title="Back to the shared pool, open to everyone">Unassign</Btn>
            <Btn kind="light" onClick={() => setSelected(new Set())}>Clear</Btn>
          </>}
          {assignMsg && <span role="status" style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: assignMsg.startsWith("!") ? "#f2a594" : selected.size ? "#a9d39b" : R.good }}>{assignMsg}</span>}
        </div>
      )}
      <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "12px 14px" }}>
        {!data ? <p style={{ color: R.mute }}>Loading…</p> : <>
          <LeadTable rows={data.data} onOpen={setOpen} player={player} now={Date.now()} meId={meId} sort={sort} onSort={setSort}
            selected={can("reassign_leads") ? selected : undefined} onSelect={select} />
          <div style={{ marginTop: 10 }}><Pagination page={page} totalPages={Math.ceil(data.total / PAGE)} onPageChange={setPage} /></div>
        </>}
      </section>
      <LeadDrawer leadId={open} isOwner={isOwner} onClose={() => { setOpen(null); mutate(); }} onSaved={() => mutate()} />
    </div>
  );
}
