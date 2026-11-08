"use client";

// Leads: the one CRM page. Follow-ups due now (blinking, always on top), the rest of today's
// follow-ups, then every lead. Order comes from the server's clock; refreshes every 30 s.
import { useEffect, useRef, useState } from "react";
import useSWR, { mutate as mutateAll } from "swr";
import { R } from "@/components/report/kit";
import { api, fetcher } from "@/lib/api";
import { type CrmConfig, type LeadRow, type QueueResponse } from "@/lib/crm";
import { useAuth } from "@/hooks/useAuth";
import { useCrmMe } from "@/hooks/useCrmMe";
import { useCrmCodes } from "@/hooks/useCrmCodes";
import { Btn, CRM_CSS, NoAccess, SectionTitle, inputStyle } from "@/components/crm/kit";
import LeadTable, { type SortState, type TableEdit } from "@/components/crm/LeadTable";
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
  const { me, can } = useCrmMe();
  if (!me) return <p style={{ color: R.mute, padding: 8 }}>Loading…</p>;
  if (!can("crm_leads")) return <NoAccess what="the Leads tab" />;
  return <LeadsBoard />;
}

function LeadsBoard() {
  const { isOwner, id: meId } = useAuth();
  const { can } = useCrmMe();
  const codes = useCrmCodes();
  const [f, setF] = useState<Filters>(EMPTY);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [preset, setPreset] = useState<string | null>(null);   // status picked in the table that needs the form
  const openedAt = useRef(Date.now());
  const knownTotal = useRef<number | null>(null);
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
  // New leads show up by themselves (refresh every 30 s); say so when the total grows
  useEffect(() => {
    const total = data?.kpis.total;
    if (total === undefined) return;
    if (knownTotal.current !== null && total > knownTotal.current) {
      const n = total - knownTotal.current;
      setToast(`${n} new lead${n === 1 ? "" : "s"} arrived: marked "new" at the top of All leads.`);
    }
    knownTotal.current = total;
  }, [data?.kpis.total]);
  // Every list on the page (queue + All leads pages) after a change
  const refreshAll = () => mutateAll((k) => typeof k === "string" && (k.startsWith("/crm/queue") || k.startsWith("/crm/leads?")));
  const now = data ? new Date(data.server_now).getTime() : Date.now();
  const today = istDay(now);
  // Due now = callbacks within 15 min, missed callbacks and retries whose wait is over
  const due = data ? [...data.sections.due_now, ...data.sections.overdue, ...data.sections.retry] : [];
  const upcoming = data ? data.sections.later.filter((l) => l.next_followup_at && istDay(l.next_followup_at) === today) : [];
  // One list (client, 8 Nov): due now / overdue / retries first, then the rest of today
  const followUps = [...due, ...upcoming];
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

  const edit: TableEdit | undefined = cfg && {
    reps: cfg.reps,
    codes: codes.inUse,
    patch: async (l, p) => {
      try {
        await api.patch(`/crm/leads/${l.id}`, { version: l.version, ...p });
        setToast(`${l.name || "Lead"}: saved`);
      } catch (e) {
        setToast(`! ${(e as Error).message}`);
      } finally {
        refreshAll();
      }
    },
    // Statuses that need nothing more save straight away; ones needing a note, a date or Guitar open the form
    status: async (l, code) => {
      const role = codes.meta(code)?.kind;
      const direct = role === "retry" || role === "other" || (role === "closed" && l.has_guitar != null);
      if (!direct) { setPreset(code); setOpen(l.id); return; }
      try {
        await api.post(`/crm/leads/${l.id}/outcome`, { version: l.version, code, assigned_to: l.assigned_to ?? null });
        setToast(`${l.name || "Lead"} saved as ${code} · ${codes.meta(code)?.label ?? ""}`);
      } catch (e) {
        setToast(`! ${(e as Error).message}`);
      } finally {
        refreshAll();
      }
    },
  };
  const clearFilters = () => { setQ(""); setF(EMPTY); };
  const sel = (flex: string) => ({ ...inputStyle, flex, width: "auto" });
  const filterLabel = { display: "grid", gap: 3, fontSize: 10.5, fontWeight: 700, color: R.mute, textTransform: "uppercase", letterSpacing: ".05em" } as const;
  return (
    <div style={{ padding: "8px 4px 40px", color: R.ink, display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 14 }}>
      <style>{CRM_CSS + RANGE_CSS}</style>
      {/* Slim band (client, 8 Nov): title and the four numbers on one line */}
      <section style={{ background: "linear-gradient(160deg,#3b2a1e,#5a4231 75%,#6f4f35)", color: "#fff", borderRadius: 12, padding: "8px 14px",
        display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Leads</h1>
        {([["Total", data?.kpis.total, "#fff"], ["New", data?.kpis.new_leads, "#fff"], ["Due today", data?.kpis.due_today, "#fff"], ["Converted", data?.kpis.converted, "#a9d39b"]] as const).map(([label, v, c]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: R.gold }}>{label}</span>
            <b style={{ fontSize: 17, color: c, fontVariantNumeric: "tabular-nums" }}>{v ?? "—"}</b>
          </span>
        ))}
        {IS_DEV && <span style={{ marginLeft: "auto" }}><Btn kind="light" onClick={simulate} disabled={simulating} title="Dev only: sends one fake lead through the intake endpoint">
          {simulating ? "Sending…" : "＋ Simulate new lead"}</Btn></span>}
      </section>

      {toast && <div role="status" style={{ background: toast.startsWith("!") ? "#f8e3df" : "#e5efe0", color: toast.startsWith("!") ? R.bad : R.good, borderRadius: 12, padding: "10px 14px", fontWeight: 600, fontSize: 13.5 }}>{toast}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: 10 }}>
        <label style={{ ...filterLabel, flex: "2 1 220px" }}>Search
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setF((x) => ({ ...x, q }))} placeholder="Name or contact…" style={sel("1")} /></label>
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
        {/* After the filters (client, 8 Nov). Filters apply as you type or pick; Search / Enter applies the text at once */}
        <span style={{ display: "flex", gap: 8, alignItems: "end", marginLeft: "auto" }}>
          <Btn onClick={() => setF((x) => ({ ...x, q }))} title="Apply the search now">Search</Btn>
          <Btn kind="ghost" onClick={clearFilters} title="Clear every filter">Clear</Btn>
          {can("export_leads") && <Btn kind="good" onClick={exportCsv} disabled={exporting} title="Download exactly the leads these filters show (CSV)">
            {exporting ? "Downloading…" : "⇩ Download"}</Btn>}
        </span>
      </div>

      {next && (
        <div role="status" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "#fff4dc", border: `1px solid ${R.gold}`, borderRadius: 12, padding: "10px 14px", fontSize: 13.5 }}>
          <span aria-hidden style={{ fontSize: 18 }}>🔔</span>
          <span><b style={{ color: "#8a5a12" }}>{dueText(next, now)} — moved to top automatically.</b>{" "}
            {next.name || "A lead"}&apos;s follow-up is at {new Date(next.next_followup_at!).toLocaleTimeString("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true })}. Please call now.</span>
          <span style={{ marginLeft: "auto" }}><Btn kind="ghost" onClick={() => dueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>View follow-ups ({due.length} due)</Btn></span>
        </div>
      )}

      {error ? <p role="alert" style={{ color: R.bad }}>{(error as Error).message}</p>
        : !data ? <p style={{ color: R.mute }}>Loading leads…</p>
        : <>
          <Section anchor={dueRef} title="Follow-ups today" rows={followUps} onOpen={setOpen} now={now} meId={meId} edit={edit}
            empty="Nothing due now and nothing more scheduled for today" />
          <AllLeads f={f} onOpen={setOpen} now={now} meId={meId} newSince={openedAt.current} edit={edit} />
        </>}

      <LeadDrawer leadId={open} presetCode={preset} onClose={() => { setOpen(null); setPreset(null); refreshAll(); }} onSaved={(m) => { setToast(m); refreshAll(); }} isOwner={isOwner} />
    </div>
  );
}

function dueText(l: LeadRow, now: number) {
  const m = Math.round((new Date(l.next_followup_at!).getTime() - now) / 60_000);
  return m > 0 ? `Due in ${m} minute${m === 1 ? "" : "s"}` : "Due now";
}

function Section({ title, rows, onOpen, now, meId, empty, anchor, edit }: {
  title: string; rows: LeadRow[]; onOpen: (id: string) => void; now: number; meId: string; empty: string; anchor?: React.Ref<HTMLElement>; edit?: TableEdit;
}) {
  return (
    <section ref={anchor} style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "12px 14px", scrollMarginTop: 12 }}>
      <SectionTitle count={rows.length}>{title}</SectionTitle>
      <LeadTable rows={rows} onOpen={onOpen} now={now} meId={meId} empty={empty} edit={edit} />
    </section>
  );
}

function AllLeads({ f, onOpen, now, meId, newSince, edit }: { f: Filters; onOpen: (id: string) => void; now: number; meId: string; newSince: number; edit?: TableEdit }) {
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
        {/* Serial numbers count down: the newest lead is the highest number (client, 8 Nov) */}
        <LeadTable rows={data.data} onOpen={onOpen} now={now} meId={meId} sort={sort} onSort={setSort} start={first} serialFrom={data.total - first + 1}
          newSince={newSince} edit={edit} empty="No leads match these filters" />
        {data.total > size && <div style={{ marginTop: 10 }}><Pagination page={page} totalPages={Math.ceil(data.total / size)} onPageChange={setPage} /></div>}
      </>}
    </section>
  );
}
