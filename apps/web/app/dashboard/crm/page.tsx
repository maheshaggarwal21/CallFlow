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
import LeadTable, { ActiveLead, type SortState, type TableEdit } from "@/components/crm/LeadTable";
import LeadDrawer from "@/components/crm/LeadDrawer";
import { Icon } from "@/components/crm/icons";
import Pagination from "@/components/ui/Pagination";

// Date range halves: hide the native picker icon (ours sits on the left) but keep it clickable over the whole half
const RANGE_CSS = `.crm-range input::-webkit-calendar-picker-indicator{position:absolute;inset:0;width:auto;height:auto;opacity:0;cursor:pointer}
  .crm-range input:focus{outline:none}.crm-range:focus-within{background:#fff4e3;box-shadow:inset 0 -2px 0 ${R.out}}`;
const IS_DEV = process.env.NODE_ENV !== "production";
const IST = "Asia/Kolkata";
// The follow-up bell on the Leads band (client, 20 Nov 2026): swings and its red count pulses while follow-ups are due
const BELL_CSS = `@keyframes crm-ring{0%,60%,100%{transform:rotate(0)}6%,18%,30%{transform:rotate(16deg)}12%,24%,36%{transform:rotate(-16deg)}}
  @keyframes crm-pulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.6)}50%{box-shadow:0 0 0 6px rgba(220,38,38,0)}}
  .crm-bell-on svg{animation:crm-ring 1.8s ease-in-out infinite;transform-origin:50% 8%}
  .crm-bell-on .crm-bell-n{animation:crm-pulse 1.4s ease-in-out infinite}
  @media (prefers-reduced-motion:reduce){.crm-bell-on svg,.crm-bell-on .crm-bell-n{animation:none}}`;
/** A short two-strike bell made in the browser (no sound file). Browsers stay silent until the page has been clicked once. */
function ringBell() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    for (const t of [0, 0.45]) for (const [hz, vol] of [[880, 0.25], [2200, 0.08]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = ctx.currentTime + t;
      o.frequency.value = hz; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.8);
      o.start(at); o.stop(at + 0.85);
    }
    setTimeout(() => ctx.close(), 1600);
  } catch { /* no sound on this browser */ }
}
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
  const [size, setSize] = useState(50);   // leads per page in All leads (client, 20 Nov 2026)
  const [open, setOpen] = useState<string | null>(null);
  // The lead this person last touched stays highlighted (client, 20 Nov 2026); kept in this browser across reloads,
  // per login, so two reps sharing a computer each keep their own
  const activeKey = meId ? `crm-active-lead:${meId}` : null;
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeKey) return;
    try { setActiveId(localStorage.getItem(activeKey)); } catch { setActiveId(null); /* storage blocked: highlight just isn't remembered */ }
  }, [activeKey]);
  const setActive = (id: string) => {
    setActiveId(id);
    try { if (activeKey) localStorage.setItem(activeKey, id); } catch { /* as above */ }
  };
  useEffect(() => { if (open) setActive(open); }, [open]);
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
  // Ring once for every follow-up that comes into its "due now" window (15 min before its time) while the page is open
  const seenDue = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const ids = data.sections.due_now.map((l) => l.id);
    if (seenDue.current && ids.some((id) => !seenDue.current!.has(id))) ringBell();
    seenDue.current = new Set([...(seenDue.current ?? []), ...ids]);
  }, [data]);

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
    details: can("edit_leads"),
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
    // Any status picked in the table saves straight away, with no note or date needed (client, 20 Nov 2026);
    // the lead form still asks for them. A follow-up date can be set in the row's Next follow-up cell.
    status: async (l, code) => {
      try {
        await api.post(`/crm/leads/${l.id}/outcome`, { version: l.version, code, assigned_to: l.assigned_to ?? null, quick: true });
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
      <style>{CRM_CSS + RANGE_CSS + BELL_CSS}</style>
      {/* Slim band (client, 8 Nov): title and the four numbers on one line */}
      {/* stays on screen under the top bar while the page scrolls (client, 20 Nov 2026) */}
      <section style={{ position: "sticky", top: 52, zIndex: 20, boxShadow: "0 6px 14px -8px rgba(43,33,24,.45)",
        background: "linear-gradient(160deg,#3b2a1e,#5a4231 75%,#6f4f35)", color: "#fff", borderRadius: 12, padding: "8px 14px",
        display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Leads</h1>
        {([["Total", data?.kpis.total, "#fff"], ["New", data?.kpis.new_leads, "#fff"], ["Due today", data?.kpis.due_today, "#fff"], ["Converted", data?.kpis.converted, "#a9d39b"]] as const).map(([label, v, c]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: R.gold }}>{label}</span>
            <b style={{ fontSize: 17, color: c, fontVariantNumeric: "tabular-nums" }}>{v ?? "—"}</b>
          </span>
        ))}
        {/* due now + overdue + retries whose wait is over: the same count as "View follow-ups (N due)" */}
        <button type="button" className={due.length ? "crm-bell-on" : undefined} onClick={() => dueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          title={due.length ? `${due.length} follow-up${due.length === 1 ? "" : "s"} due now or overdue` : "No follow-ups due"} aria-label={`${due.length} follow-ups due`}
          style={{ marginLeft: "auto", position: "relative", width: 38, height: 38, borderRadius: 10, border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)",
            color: due.length ? R.gold : "rgba(255,255,255,.7)", display: "inline-grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
          <Icon name="bell" size={20} />
          {due.length > 0 && <span className="crm-bell-n" style={{ position: "absolute", top: -6, right: -6, minWidth: 20, height: 20, padding: "0 5px", borderRadius: 10,
            background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 800, display: "grid", placeItems: "center", border: "2px solid #4a3527" }}>{due.length > 99 ? "99+" : due.length}</span>}
        </button>
        {IS_DEV && <span><Btn kind="light" onClick={simulate} disabled={simulating} title="Dev only: sends one fake lead through the intake endpoint">
          {simulating ? "Sending…" : "＋ Simulate new lead"}</Btn></span>}
      </section>

      {toast && <div role="status" style={{ background: toast.startsWith("!") ? "#f8e3df" : "#e5efe0", color: toast.startsWith("!") ? R.bad : R.good, borderRadius: 12, padding: "10px 14px", fontWeight: 600, fontSize: 13.5 }}>{toast}</div>}

      {/* Two lines (client, 20 Nov 2026): the filters, then a small Leads per page under Search with the buttons on its right */}
      <div style={{ display: "grid", gap: 6, background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
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
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: R.mute }}>Leads per page
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ ...inputStyle, width: "auto", padding: "3px 6px", fontSize: 12 }}>
            {[50, 100, 150, 200, 250, 300].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        {/* Filters apply as you type or pick; Search / Enter applies the text at once */}
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn onClick={() => setF((x) => ({ ...x, q }))} title="Apply the search now">Search</Btn>
          <Btn kind="ghost" onClick={clearFilters} title="Clear every filter">Clear</Btn>
          {can("export_leads") && <Btn kind="good" onClick={exportCsv} disabled={exporting} title="Download exactly the leads these filters show (CSV)">
            {exporting ? "Downloading…" : "⇩ Download"}</Btn>}
        </span>
      </div>
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
          <ActiveLead.Provider value={{ id: activeId, set: setActive }}>
          <Section anchor={dueRef} title="Follow-ups today" rows={followUps} onOpen={setOpen} now={now} meId={meId} edit={edit}
            empty="Nothing due now and nothing more scheduled for today" />
          <AllLeads f={f} size={size} onOpen={setOpen} now={now} meId={meId} newSince={openedAt.current} edit={edit} />
          </ActiveLead.Provider>
        </>}

      <LeadDrawer leadId={open} onClose={() => { setOpen(null); refreshAll(); }} onSaved={(m) => { setToast(m); refreshAll(); }} isOwner={isOwner} />
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
    <section ref={anchor} style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "12px 14px",
      // the bell and "View follow-ups" land with the title and table headers just under the pinned Leads band (52 px bar + band)
      scrollMarginTop: 120 }}>
      <SectionTitle count={rows.length}>{title}</SectionTitle>
      <LeadTable rows={rows} onOpen={onOpen} now={now} meId={meId} empty={empty} edit={edit} />
    </section>
  );
}

function AllLeads({ f, size, onOpen, now, meId, newSince, edit }: { f: Filters; size: number; onOpen: (id: string) => void; now: number; meId: string; newSince: number; edit?: TableEdit }) {
  const [sort, setSort] = useState<SortState>({ sort: "created_at", dir: "desc" });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [f, sort, size]);
  const { data } = useSWR<{ data: LeadRow[]; total: number }>(`/crm/leads?${qs(f, { ...sort, limit: size, offset: (page - 1) * size })}`, fetcher, { refreshInterval: 30_000 });
  const first = (page - 1) * size + 1;
  return (
    <section style={{ background: R.card, border: `1px solid ${R.line}`, borderRadius: 14, padding: "12px 14px" }}>
      <SectionTitle count={data?.total} right={data && (
        <span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: R.mute }}>
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
