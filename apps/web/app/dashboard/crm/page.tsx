"use client";

// Lead Queue: every rep's starting point. Sections are ordered on the server (due now → overdue →
// new → retries due → rest) and refresh every 30 s; callbacks due within 15 min blink for everyone.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { R } from "@/components/report/kit";
import { api, fetcher } from "@/lib/api";
import { CODES, STATUS_LABEL, fmtWhen, type LeadRow, type QueueResponse } from "@/lib/crm";
import { useAuth } from "@/hooks/useAuth";
import { BandTile, Btn, CRM_CSS, HeaderBand, SectionTitle, inputStyle, tabBtn } from "@/components/crm/kit";
import LeadTable, { useInlinePlayer, type SortState } from "@/components/crm/LeadTable";
import LeadDrawer from "@/components/crm/LeadDrawer";
import Pagination from "@/components/ui/Pagination";

const IS_DEV = process.env.NODE_ENV !== "production";
type Filters = { q: string; status: string; code: string; campaign: string; date: string };
const EMPTY: Filters = { q: "", status: "", code: "", campaign: "", date: "" };
type View = "queue" | "mine" | "all";

function qs(f: Filters, extra: Record<string, string | number> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== "" && v !== undefined) p.set(k, String(v));
  return p.toString();
}

export default function LeadQueuePage() {
  const { isOwner, id: meId } = useAuth();
  const [tab, setTab] = useState<View>("queue");
  const [f, setF] = useState<Filters>(EMPTY);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [simulating, setSimulating] = useState(false);
  const player = useInlinePlayer();

  // Debounced search box
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q })), 300); return () => clearTimeout(t); }, [q]);
  // Deep link from the F digest email: /dashboard/crm?lead=<id>
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("lead"); if (id) setOpen(id); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); }, [toast]);

  const { data, error, mutate } = useSWR<QueueResponse>(`/crm/queue?${qs(f, tab === "mine" ? { assigned: "me" } : {})}`, fetcher, { refreshInterval: 30_000 });
  const now = data ? new Date(data.server_now).getTime() : Date.now();
  const campaigns = [...new Set(Object.values(data?.sections ?? {}).flat().map((l) => l.campaign).filter(Boolean))] as string[];

  const simulate = async () => {
    setSimulating(true);
    try {
      const r = await api.post<{ result: string; lead_code?: string }>("/crm/dev/simulate-lead");
      setToast(`New lead ${r.lead_code ?? ""} arrived (${r.result}). It shows in New on the next refresh.`);
    } catch (e) {
      setToast(`! ${(e as Error).message}`);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gap: 14 }}>
      <style>{CRM_CSS}</style>
      <HeaderBand eyebrow="CRM" title="Lead Queue"
        sub={data ? `Server time ${fmtWhen(data.server_now)} · refreshes every 30 s` : "Loading…"}
        right={<>
          {IS_DEV && <Btn kind="light" onClick={simulate} disabled={simulating} title="Dev only: sends one fake lead through the intake endpoint">
            {simulating ? "Sending…" : "＋ Simulate new lead"}</Btn>}
          <Btn kind="light" onClick={() => mutate()}>Refresh</Btn>
        </>}>
        <div className="crm-g5">
          <BandTile label="Due now" value={data?.kpis.due_now ?? "—"} sub="callbacks within 15 min" />
          <BandTile label="Overdue" value={data?.kpis.overdue ?? "—"} sub="callbacks missed" accent="#f2a594" />
          <BandTile label="New today" value={data?.kpis.new_today ?? "—"} sub="leads arrived" />
          <BandTile label="Converted today" value={data?.kpis.converted_today ?? "—"} sub="₹299 trials paid" accent="#a9d39b" />
          <BandTile label="My calls today" value={data?.kpis.my_calls_today ?? "—"} sub="KoreCall recordings" />
        </div>
        <nav aria-label="Queue views" style={{ display: "flex", gap: 4 }}>
          <button style={tabBtn(tab === "queue")} onClick={() => setTab("queue")} aria-current={tab === "queue"}>Shared queue</button>
          <button style={tabBtn(tab === "mine")} onClick={() => setTab("mine")} aria-current={tab === "mine"}>
            My leads {!!data?.kpis.my_leads && <span style={{ background: R.gold, color: "#3b2a1e", borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "1px 7px" }}>{data.kpis.my_leads}</span>}
          </button>
          <button style={tabBtn(tab === "all")} onClick={() => setTab("all")} aria-current={tab === "all"}>All leads</button>
        </nav>
      </HeaderBand>

      {toast && <div role="status" style={{ background: toast.startsWith("!") ? "#f8e3df" : "#e5efe0", color: toast.startsWith("!") ? R.bad : R.good, borderRadius: 12, padding: "10px 14px", fontWeight: 600, fontSize: 13.5 }}>{toast}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or lead ID…" aria-label="Search leads" style={{ ...inputStyle, flex: "2 1 240px", width: "auto" }} />
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status" style={{ ...inputStyle, flex: "1 1 120px", width: "auto" }}>
          <option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-label="Code" style={{ ...inputStyle, flex: "1 1 110px", width: "auto" }}>
          <option value="">All codes</option>{CODES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
        </select>
        <select value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })} aria-label="Campaign" style={{ ...inputStyle, flex: "1 1 160px", width: "auto" }}>
          <option value="">All campaigns</option>{campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Lead date" title="Leads that arrived on this date" style={{ ...inputStyle, flex: "0 1 150px", width: "auto" }} />
        {(q || Object.values(f).some(Boolean)) && <Btn kind="ghost" onClick={() => { setQ(""); setF(EMPTY); }}>Clear</Btn>}
      </div>

      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p>
        : tab === "all" ? <AllLeads f={f} onOpen={setOpen} player={player} now={now} meId={meId} />
        : !data ? <p style={{ color: R.mute }}>Loading queue…</p>
        : tab === "mine" && !Object.values(data.counts).some(Boolean) ? (
          <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "22px 18px", textAlign: "center", color: R.mute }}>
            <b style={{ color: R.ink, fontSize: 15 }}>No leads assigned to you right now.</b>
            <div style={{ fontSize: 13, marginTop: 4 }}>Work the shared queue: anything there is open to everyone.</div>
            <div style={{ marginTop: 10 }}><Btn kind="ghost" onClick={() => setTab("queue")}>Go to the shared queue</Btn></div>
          </section>
        ) : (
          <>
            {tab === "mine" && <p style={{ margin: "0 2px", fontSize: 13, color: R.mute }}>Leads the owner gave you, and callbacks assigned to you. Everyone can still see them in the shared queue.</p>}
            <Section title="Due now" rows={data.sections.due_now} count={data.counts.due_now} onOpen={setOpen} player={player} now={now} meId={meId} empty="No callbacks due in the next 15 minutes" />
            <Section title="Overdue callbacks" rows={data.sections.overdue} count={data.counts.overdue} onOpen={setOpen} player={player} now={now} meId={meId} empty="Nothing overdue" />
            <Section title="New" rows={data.sections.new} count={data.counts.new} onOpen={setOpen} player={player} now={now} meId={meId} empty="No new leads" />
            <Section title="Retry" rows={data.sections.retry} count={data.counts.retry} onOpen={setOpen} player={player} now={now} meId={meId} empty="No retries due yet" />
            <Section title="Later" rows={data.sections.later} count={data.counts.later} onOpen={setOpen} player={player} now={now} meId={meId} empty="Nothing scheduled" collapsed />
          </>
        )}

      <LeadDrawer leadId={open} isOwner={isOwner} onClose={() => { setOpen(null); mutate(); }} onSaved={(m) => { setToast(m); mutate(); }} />
    </div>
  );
}

function Section({ title, rows, count, onOpen, player, now, meId, empty, collapsed = false }: {
  title: string; rows: LeadRow[]; count: number; onOpen: (id: string) => void; player: ReturnType<typeof useInlinePlayer>; now: number; meId: string; empty: string; collapsed?: boolean;
}) {
  const [show, setShow] = useState(!collapsed);
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "12px 14px" }}>
      <SectionTitle count={count} right={collapsed && <Btn kind="ghost" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</Btn>}>{title}</SectionTitle>
      {show && <LeadTable rows={rows} onOpen={onOpen} player={player} now={now} meId={meId} empty={empty} />}
      {show && count > rows.length && <p style={{ margin: "8px 2px 0", fontSize: 12, color: R.mute }}>Showing the first {rows.length} of {count}. Narrow it with search or filters.</p>}
    </section>
  );
}

const PAGE = 50;
function AllLeads({ f, onOpen, player, now, meId }: { f: Filters; onOpen: (id: string) => void; player: ReturnType<typeof useInlinePlayer>; now: number; meId: string }) {
  const [sort, setSort] = useState<SortState>({ sort: "created_at", dir: "desc" });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [f, sort]);
  const { data } = useSWR<{ data: LeadRow[]; total: number }>(`/crm/leads?${qs(f, { ...sort, limit: PAGE, offset: (page - 1) * PAGE })}`, fetcher, { refreshInterval: 30_000 });
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "12px 14px" }}>
      <SectionTitle count={data?.total}>All leads</SectionTitle>
      {!data ? <p style={{ color: R.mute }}>Loading…</p> : <>
        <LeadTable rows={data.data} onOpen={onOpen} player={player} now={now} meId={meId} sort={sort} onSort={setSort} />
        {data.total > PAGE && <div style={{ marginTop: 10 }}><Pagination page={page} totalPages={Math.ceil(data.total / PAGE)} onPageChange={setPage} /></div>}
      </>}
    </section>
  );
}
