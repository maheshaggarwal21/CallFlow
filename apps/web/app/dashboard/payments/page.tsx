"use client";

// Payments tab (client, 14 Nov 2026): the school site's payments, read only (GET /payments). Adding, editing
// and deleting payments stays on the school site. A User sees only their own; Admins and the Super Admin see
// everyone. The dates are asked of the server; search and the dropdowns filter what came back.
import { useState } from "react";
import useSWR from "swr";
import { C } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import { inkOn } from "@/lib/crm";
import { useAuth } from "@/hooks/useAuth";
import { inr } from "@/lib/money";
import { istToday } from "@/lib/period";
import { S } from "@/components/salary/kit";
import { Icon } from "@/components/crm/icons";
import Tag from "@/components/ui/Tag";

type Pay = {
  id: string; name: string; linked_to: string; email: string; phone: string; amount: number;
  paid_date: string; mode: string; rep: string; fee_type: string; receipt_url: string | null;
  /** Status code 1, 2, 3… (named on CRM & Pay Settings); every payment starts on 1. */
  status: string;
};
type Codes = Record<string, { label: string; color?: string }>;
type Answer = { from: string; to: string; connected: boolean; codes: Codes; payments: Pay[]; missing: { name: string; error: string }[] };

const LINK_CLR: Record<string, [string, string]> = {
  student: [C.green, C.greenLight], request: [C.orange, C.orangeLight], incomplete: [C.muted, C.bgDeep],
};
const dmy = (d: string) => d.split("-").reverse().join("/");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** One CSV cell; a leading = + - @ is defused so a spreadsheet never runs it as a formula. */
const cell = (v: string | number) => {
  const s = String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export default function PaymentsPage() {
  const today = istToday();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("");
  const [rep, setRep] = useState("");
  const [fee, setFee] = useState("");
  const [status, setStatus] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const { role } = useAuth();
  const canGrade = role !== "employee";
  const ok = !!from && !!to && from <= to;
  const { data, error, isLoading, isValidating, mutate } = useSWR<Answer>(ok ? `/payments?from=${from}&to=${to}` : null, fetcher, { keepPreviousData: true });

  const all = data?.payments ?? [];
  const needle = q.trim().toLowerCase();
  const rows = all.filter((p) =>
    (!mode || p.mode === mode) && (!status || p.status === status) && (!rep || p.rep === rep) && (!fee || p.fee_type === fee) &&
    (!needle || [p.name, p.email, p.phone].some((v) => v.toLowerCase().includes(needle))));
  const total = rows.reduce((t, p) => t + p.amount, 0);
  const codes = data?.codes ?? {};
  const codeIds = Object.keys(codes).sort((a, b) => Number(a) - Number(b));
  const codeText = (c: string) => `${c} · ${codes[c]?.label ?? `Code ${c}`}`;

  async function grade(p: Pay, code: string) {
    setSaveErr("");
    // shown at once; put back if the server refuses
    const swap = (to: string) => (d?: Answer) => d && { ...d, payments: d.payments.map((x) => (x.id === p.id ? { ...x, status: to } : x)) };
    mutate(swap(code), { revalidate: false });
    try { await api.patch(`/payments/${encodeURIComponent(p.id)}/status`, { code }); }
    catch (e) { mutate(swap(p.status), { revalidate: false }); setSaveErr((e as Error).message); }
  }

  function exportCsv() {
    const head = ["Name", "Status", "Student", "Email", "Phone", "Amount", "Paid date", "Payment mode", "Representative", "Fee type", "Receipt"];
    const lines = rows.map((p) => [p.name, codeText(p.status), p.linked_to, p.email, p.phone, p.amount, p.paid_date, p.mode, p.rep, p.fee_type, p.receipt_url ?? ""]);
    const url = URL.createObjectURL(new Blob([[head, ...lines].map((l) => l.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `payments-${from}-to-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const select = (label: string, value: string, set: (v: string) => void, opts: string[]) => (
    <select aria-label={label} value={value} onChange={(e) => set(e.target.value)} style={{ ...S.input, width: "auto", minWidth: 150, background: C.card }}>
      <option value="">{label}</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={S.h1}>Payments</h1>
          <p style={S.sub}>Fees recorded on the school site · {rows.length} payment{rows.length === 1 ? "" : "s"} · {inr(total)}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => mutate()} disabled={isValidating} style={S.btn} title="Load again">
            <Icon name="retry" size={15} /> {isValidating ? "Loading…" : "Refresh"}</button>
          <button type="button" onClick={exportCsv} disabled={!rows.length} style={S.btn}><Icon name="download" size={15} /> Export CSV</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input type="search" placeholder="Search name, email or phone…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ ...S.input, width: 260, background: C.card }} />
        {select("All modes", mode, setMode, uniq(all.map((p) => p.mode)))}
        {select("All representatives", rep, setRep, uniq(all.map((p) => p.rep)))}
        {select("All fee types", fee, setFee, uniq(all.map((p) => p.fee_type)))}
        <select aria-label="All statuses" value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...S.input, width: "auto", minWidth: 150, background: C.card }}>
          <option value="">All statuses</option>
          {codeIds.map((c) => <option key={c} value={c}>{codeText(c)}</option>)}
        </select>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={{ ...S.input, width: 150, background: C.card }} />
          <span style={{ color: C.muted }}>–</span>
          <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ ...S.input, width: 150, background: C.card }} />
        </span>
      </div>

      {!ok && <p role="alert" style={{ margin: 0, color: C.red, fontSize: 14 }}>Pick a start date on or before the end date.</p>}
      {saveErr && <p role="alert" style={{ margin: 0, color: C.red, fontSize: 14 }}>{saveErr}</p>}
      {error && <p role="alert" style={{ ...S.card, margin: 0, padding: 20, color: C.red }}>{(error as Error).message}</p>}
      {data && !data.connected && (
        <p role="status" style={{ ...S.card, margin: 0, padding: "14px 20px", fontSize: 14, color: C.textSub, borderColor: C.orangeBdr, background: C.orangeLight }}>
          Payments from the school site are not connected yet.</p>
      )}
      {!!data?.missing.length && (
        <p role="status" style={{ ...S.card, margin: 0, padding: "14px 20px", fontSize: 14, color: C.textSub, borderColor: C.orangeBdr, background: C.orangeLight }}>
          Not shown: {data.missing.map((m) => m.name).join(", ")}. {data.missing[0].error}.</p>
      )}

      {isLoading && !data ? <p style={{ color: C.muted, fontSize: 14 }}>Loading payments from the school site…</p> : data && (
        <div style={{ ...S.card, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: C.bgDeep, borderBottom: `2px solid ${C.border}` }}>
                {["Name", "Status", "Contact", "Amount", "Paid date", "Payment mode", "Representative", "Fee type", "Receipt"].map((h) => (
                  <th key={h} style={{ ...S.th, padding: "14px 12px", textAlign: h === "Amount" ? "right" : "left" }}>{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 28, color: C.muted }}>No payments match.</td></tr>
              )}
              {rows.map((p) => {
                const [lc, lbg] = LINK_CLR[p.linked_to] ?? [C.muted, C.bgDeep];
                const trial = p.fee_type.trim().toLowerCase() === "trial";
                return (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                    <td style={td}>
                      <div style={{ fontWeight: 700, color: C.text }}>{p.name || "—"}</div>
                      {p.linked_to && <div style={{ fontSize: 12, fontWeight: 600, color: lc }}>{cap(p.linked_to)}</div>}
                    </td>
                    <td style={td}><StatusCell code={p.status} codes={codes} codeIds={codeIds} label={codeText}
                      onPick={canGrade ? (c) => grade(p, c) : undefined} /></td>
                    <td style={td}>
                      <Copyable text={p.email} />
                      <Copyable text={p.phone} mono />
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>{inr(p.amount)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{dmy(p.paid_date)}</td>
                    <td style={td}>{p.mode ? <Tag label={p.mode} color={C.blue} bg={C.blueLight} style={{ fontSize: 12 }} /> : "—"}</td>
                    <td style={td}>{p.rep || "—"}</td>
                    <td style={td}>{p.fee_type ? <Tag label={p.fee_type} color={trial ? C.blue : C.teal} bg={trial ? C.blueLight : C.tealLight} style={{ fontSize: 12 }} /> : "—"}</td>
                    <td style={td}>{p.receipt_url
                      ? <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" style={{ color: C.orange, fontWeight: 700 }}>View</a>
                      : <span style={{ color: C.muted }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>
        Read from the school site. To add, change or delete a payment, use the school site. A receipt link works for a limited time; press Refresh if it has expired.</p>
    </div>
  );
}

const td = { padding: "12px 12px", verticalAlign: "middle", color: C.textSub } as const;

function Copyable({ text, mono }: { text: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: mono ? "ui-monospace, monospace" : undefined, fontSize: mono ? 13 : 13.5 }}>
      <span style={mono ? { whiteSpace: "nowrap" } : { overflowWrap: "anywhere" }}>{text}</span>
      <button type="button" title={`Copy ${text}`} aria-label={`Copy ${text}`}
        onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}
        style={{ border: "none", background: "none", padding: 2, cursor: "pointer", color: done ? C.green : C.muted, display: "inline-flex" }}>
        <Icon name={done ? "check" : "copy"} size={13} />
      </button>
    </div>
  );
}

/** The payment's status code as a coloured chip; Admins and the Super Admin pick another code from it. */
function StatusCell({ code, codes, codeIds, label, onPick }: {
  code: string; codes: Codes; codeIds: string[]; label: (c: string) => string; onPick?: (code: string) => void;
}) {
  const color = codes[code]?.color;
  const chip = { background: color ?? C.bgDeep, color: color ? inkOn(color) : C.textSub, border: `1px solid ${color ?? C.border}`,
    borderRadius: 8, fontSize: 13, fontWeight: 800, padding: "4px 8px" } as const;
  if (!onPick) return <span title={codes[code]?.label} style={chip}>{code}</span>;
  return (
    <select aria-label="Payment status" title={codes[code]?.label} value={code} onChange={(e) => onPick(e.target.value)} style={{ ...chip, cursor: "pointer", maxWidth: 120 }}>
      {codeIds.map((c) => <option key={c} value={c}>{label(c)}</option>)}
    </select>
  );
}
