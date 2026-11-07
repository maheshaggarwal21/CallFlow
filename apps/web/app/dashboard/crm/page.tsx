"use client";

// Leads: the one CRM page. Follow-ups due now (blinking, always on top), the rest of today's
// follow-ups, then every lead. Order comes from the server's clock; refreshes every 30 s.
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { R } from "@/components/report/kit";
import { api, fetcher } from "@/lib/api";
import { type CrmConfig, type LeadRow, type QueueResponse } from "@/lib/crm";
import { useAuth } from "@/hooks/useAuth";
import { useCrmMe } from "@/hooks/useCrmMe";
import { useCrmCodes } from "@/hooks/useCrmCodes";
import { BandTile, Btn, CRM_CSS, HeaderBand, SectionTitle, inputStyle } from "@/components/crm/kit";
import LeadTable, { type SortState } from "@/components/crm/LeadTable";
import LeadDrawer from "@/components/crm/LeadDrawer";
import { Icon } from "@/components/crm/icons";
import Pagination from "@/components/ui/Pagination";

// Date range halves: hide the native picker icon (ours sits on the left) but keep it clickable over the whole half
const RANGE_CSS = `.crm-range input::-webkit-calendar-picker-indicator{position:absolute;inset:0;width:auto;height:auto;opacity:0;cursor:pointer}
  .crm-range input:focus{outline:none}.crm-range:focus-within{background:#fff4e3;box-shadow:inset 0 -2px 0 ${R.out}}`;
const IS_DEV = process.env.NODE_ENV !== "production";
const IST = "Asia/Kolkata";
type Filters = { q: string; status: string; code: string; assigned: string; fdate: string; from: string; to: string };
const EMPTY: Filters = { q: "", status: "", code: "", assigned: "", fdate: "", to: "", from: "" };
const istDay = (d: string | number) => new Date(d).toLocaleDateString("en-CA", { timeZone: IST });

function qs(f: Filters, extra: Record<string, string | number> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== "" && v !== undefined) p.set(k, String(v));
  return p.toString();
}

export default function LeadsPage() {
  const { isOwner, id: meId } = useAuth();
  const { can } = useCrmMe();
  const codes = useCrmCodes();
  const [f, setF] = useState<Filters>(EMPTY);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dueRef = useRef<HTMLElement>(null);

  // Debounced search box
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q })), 300); return () => clearTimeout(t); }, [q]);
  // Deep link: /dashboard/crm?lead=<id>
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("lead"); if (id) setOpen(id); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); }, [toast]);

  const { data: cfg } = useSWR<CrmConfig>("/crm/config", fetcher);
  const { data, error, mutate } = useSWR<QueueResponse>(`/crm/queue?${qs(f)}`, fetcher, { refreshInterval: 30_000 });
  const now = data ? new Date(data.server_now).getTime() : Date.now();
  const today = istDay(now);
  // Due now = callbacks within 15 min, missed callbacks and retries whose wait is over
  const due = data ? [...data.sections.due_now, ...data.sections.overdue, ...data.sections.retry] : [];
  const upcoming = data ? data.sections.later.filter((l) => l.next_followup_at && istDay(l.next_followup_at) === today) : [];
  const next = data?.sections.due_now[0];

  // One select for the client's statuses: "New"/"Dropped" are lead states, the rest are outcome codes
  const statusValue = f.code ? `c:${f.code}` : f.status ? `s:${f.status}` : "";
  const setStatus = (v: string) => setF({ ...f, status: v.startsWith("s:") ? v.slice(2) : "", code: v.startsWith("c:") ? v.slice(2) : "" });

  const simulate = async () => {
    setSimulating(true);
    try {
      const r = await api.post<{ result: string; lead_code?: string }>("/crm/dev/simulate-lead");
      setToast(`New lead ${r.lead_code ?? ""} arrived (${r.result}). It shows in All leads on the next refresh.`);
    } catch (e) {
      setToast(`! ${(e as Error).message}`);
    } finally {
      setSimulating(false);
    }
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const url = URL.createObjectURL(await api.getBlob(`/crm/leads/export.csv?${qs(f)}`));
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setToast(`! ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const sel = (flex: string) => ({ ...inputStyle, flex, width: "auto" });
  const filterLabel = { display: "grid", gap: 3, fontSize: 10.5, fontWeight: 700, color: R.mute, textTransform: "uppercase", letterSpacing: ".05em" } as const;
  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 14 }}>
      <style>{CRM_CSS + RANGE_CSS}</style>
      <HeaderBand eyebrow="CRM" title="Leads" sub="Track every lead, its status and follow-ups · refreshes every 30 s"
        right={<>
          {IS_DEV && <Btn kind="light" onClick={simulate} disabled={simulating} title="Dev only: sends one fake lead through the intake endpoint">
            {simulating ? "Sending…" : "＋ Simulate new lead"}</Btn>}
          <Btn kind="light" onClick={() => { setQ(""); setF(EMPTY); }} title="Clear every filter">↺ Reset</Btn>
          {can("export_leads") && <Btn kind="good" onClick={exportCsv} disabled={exporting} title="Download the filtered leads as CSV">{exporting ? "Exporting…" : "⇩ Export"}</Btn>}
          <Btn kind="light" onClick={() => mutate()}>Refresh</Btn>
        </>}>
        <div className="crm-g4">
          <BandTile label="Total leads" value={data?.kpis.total ?? "—"} />
          <BandTile label="New leads" value={data?.kpis.new_leads ?? "—"} sub="not called yet" />
          <BandTile label="Follow-ups due today" value={data?.kpis.due_today ?? "—"} />
          <BandTile label="Converted" value={data?.kpis.converted ?? "—"} sub="₹299 trials paid" accent="#a9d39b" />
        </div>
      </HeaderBand>

      {toast && <div role="status" style={{ background: toast.startsWith("!") ? "#f8e3df" : "#e5efe0", color: toast.startsWith("!") ? R.bad : R.good, borderRadius: 12, padding: "10px 14px", fontWeight: 600, fontSize: 13.5 }}>{toast}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: 10 }}>
        <label style={{ ...filterLabel, flex: "2 1 220px" }}>Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or contact…" style={sel("1")} /></label>
        <label style={{ ...filterLabel, flex: "1 1 130px" }}>Lead status
          <select value={statusValue} onChange={(e) => setStatus(e.target.value)} style={sel("1")}>
            <option value="">All statuses</option><option value="s:new">New</option>
            {codes.inUse.map((c) => <option key={c.code} value={`c:${c.code}`}>{c.code} · {c.label}</option>)}
            <option value="s:dropped">Dropped</option>
          </select></label>
        <label style={{ ...filterLabel, flex: "1 1 150px" }}>Representative
          <select value={f.assigned} onChange={(e) => setF({ ...f, assigned: e.target.value })} style={sel("1")}>
            <option value="">All representatives</option><option value="me">Me</option><option value="none">Not assigned</option>
            {cfg?.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
        <label style={{ ...filterLabel, flex: "0 1 140px" }}>Follow-up date
          <input type="date" value={f.fdate} onChange={(e) => setF({ ...f, fdate: e.target.value })} style={sel("1")} /></label>
        <div role="group" aria-label="Date range (received)" style={{ ...filterLabel, flex: "0 1 330px" }}>Date range (received)
          {/* One thin box for the range: [icon From | icon To]; the native picker covers each half, so a click anywhere opens it */}
          <span style={{ ...inputStyle, display: "flex", alignItems: "stretch", padding: 0, overflow: "hidden" }}>
            {([["from", "From", { max: f.to || undefined }], ["to", "To", { min: f.from || undefined }]] as const).map(([k, label, lim], i) => (
              <span key={k} className="crm-range" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, padding: "0 10px", position: "relative",
                borderLeft: i ? `1px solid ${R.line}` : undefined }}>
                <Icon name="calendar" size={15} style={{ color: R.out }} />
                <input type="date" value={f[k]} {...lim} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={label}
                  style={{ ...inputStyle, border: 0, background: "transparent", padding: "8px 0", flex: 1, minWidth: 0 }} />
              </span>
            ))}
          </span></div>
      </div>

      {next && (
        <div role="status" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "#fff4dc", border: `1px solid ${R.gold}`, borderRadius: 12, padding: "10px 14px", fontSize: 13.5 }}>
          <span aria-hidden style={{ fontSize: 18 }}>🔔</span>
          <span><b style={{ color: "#8a5a12" }}>{dueText(next, now)} — moved to top automatically.</b>{" "}
            {next.name || "A lead"}&apos;s follow-up is at {new Date(next.next_followup_at!).toLocaleTimeString("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true })}. Please call now.</span>
          <span style={{ marginLeft: "auto" }}><Btn kind="ghost" onClick={() => dueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>View all due now ({due.length})</Btn></span>
        </div>
      )}

      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p>
        : !data ? <p style={{ color: R.mute }}>Loading leads…</p>
        : <>
          <Section anchor={dueRef} title="Follow-up due now" rows={due} onOpen={setOpen} now={now} meId={meId} empty="Nothing due right now" />
          <Section title="Upcoming today" rows={upcoming} onOpen={setOpen} now={now} meId={meId} empty="No more follow-ups scheduled for today" />
          <AllLeads f={f} onOpen={setOpen} now={now} meId={meId} />
        </>}

      <LeadDrawer leadId={open} onClose={() => { setOpen(null); mutate(); }} onSaved={(m) => { setToast(m); mutate(); }} isOwner={isOwner} />
    </div>
  );
}

function dueText(l: LeadRow, now: number) {
  const m = Math.round((new Date(l.next_followup_at!).getTime() - now) / 60_000);
  return m > 0 ? `Due in ${m} minute${m === 1 ? "" : "s"}` : "Due now";
}

function Section({ title, rows, onOpen, now, meId, empty, anchor }: {
  title: string; rows: LeadRow[]; onOpen: (id: string) => void; now: number; meId: string; empty: string; anchor?: React.Ref<HTMLElement>;
}) {
  return (
    <section ref={anchor} style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "12px 14px", scrollMarginTop: 12 }}>
      <SectionTitle count={rows.length}>{title}</SectionTitle>
      <LeadTable rows={rows} onOpen={onOpen} now={now} meId={meId} empty={empty} />
    </section>
  );
}

function AllLeads({ f, onOpen, now, meId }: { f: Filters; onOpen: (id: string) => void; now: number; meId: string }) {
  const [sort, setSort] = useState<SortState>({ sort: "created_at", dir: "desc" });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  useEffect(() => setPage(1), [f, sort, size]);
  const { data } = useSWR<{ data: LeadRow[]; total: number }>(`/crm/leads?${qs(f, { ...sort, limit: size, offset: (page - 1) * size })}`, fetcher, { refreshInterval: 30_000 });
  const first = (page - 1) * size + 1;
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "12px 14px" }}>
      <SectionTitle count={data?.total} right={data && (
        <span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: R.mute }}>
          <label>Show <select value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ ...inputStyle, width: "auto", padding: "4px 8px" }}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} rows</option>)}</select></label>
          {data.total ? `${first}–${Math.min(first + size - 1, data.total)} of ${data.total}` : ""}
        </span>
      )}>All leads</SectionTitle>
      {!data ? <p style={{ color: R.mute }}>Loading…</p> : <>
        <LeadTable rows={data.data} onOpen={onOpen} now={now} meId={meId} sort={sort} onSort={setSort} start={first} empty="No leads match these filters" />
        {data.total > size && <div style={{ marginTop: 10 }}><Pagination page={page} totalPages={Math.ceil(data.total / size)} onPageChange={setPage} /></div>}
      </>}
    </section>
  );
}
