// Access and validation checks for the Users tab, ranks and tabs, against the LOCAL demo API.
// Run: npm run crm:e2e (with npm run crm:dev already running). crmDevEnv refuses any non-local database.
// It adds a temporary line 99 and test users, and removes them again at the end.
import { readFileSync } from "node:fs";
import poolMod from "../dist/db/pool.js";
import { startMock } from "./mock-payments.mjs";
const pool = poolMod.default;
const A = `http://localhost:${process.env.PORT || 4000}/api/v1`;
const PW = readFileSync(new URL("../src/seedCrm.ts", import.meta.url), "utf8").match(/Demo@\d+/)[0];
let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`); };

async function login(email, password = PW) {
  const r = await fetch(`${A}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const m = (r.headers.get("set-cookie") ?? "").match(/token=([^;]+)/);
  return { status: r.status, token: m?.[1] };
}
const call = async (token, method, path, body) => {
  const r = await fetch(`${A}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { cookie: `token=${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data; try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data, msg: data?.message ?? data?.error ?? "" };
};

const owner = (await login("owner@crm-demo.local")).token;
// start from daily pay Off, whatever an earlier interrupted run left behind (the daily-pay block switches it on itself)
await call(owner, "PUT", "/pay/settings", { weekdays: [1, 2, 3, 4, 5, 6], daily_pay_from: null });
const neha = (await login("neha@crm-demo.local")).token;
ok(!!owner && !!neha, "demo logins work");

const stamp = Date.now().toString().slice(-6);
const base = { name: "E2E Rep", email: `e2e${stamp}@crm-demo.local`, password: "E2e@12345" };
const ex = { name: "Diwali push", amount: 100, from: "2026-11-13", to: "2099-11-19" };
const dd = { name: "Late coming", type: "pct", amount: 10, from: "2026-11-01", to: "2099-12-31" };

// ── validation: each must be refused with a readable message ──
const bad = [
  ["no password", { name: "X", email: `x${stamp}@crm-demo.local` }, 400],
  ["7-letter password", { ...base, password: "short12" }, 400],
  ["bad email", { ...base, email: "not-an-email" }, 400],
  ["5-digit phone", { ...base, phone: "12345" }, 400],
  ["negative salary", { ...base, fix_salary: -5 }, 400],
  ["unknown rank", { ...base, role: "god" }, 400],
  ["pct commission type typo", { ...base, trial_commission_type: "percent" }, 400],
  ["calling target over 24h", { ...base, target_call_secs: 90000 }, 400],
  ["extra: end before start", { ...base, extra_commissions: [{ ...ex, from: "2100-01-01" }] }, 400, /Extra commission 1: The end date/],
  ["extra: bad date", { ...base, extra_commissions: [{ ...ex, to: "19-11-2026" }] }, 400],
  ["deduction: 150%", { ...base, extra_deductions: [{ ...dd, amount: 150 }] }, 400, /Extra deduction 1: A percentage/],
  ["deduction: bad type", { ...base, extra_deductions: [{ ...dd, type: "half" }] }, 400],
  ["deduction: end before start", { ...base, extra_deductions: [{ ...dd, to: "2026-10-01" }] }, 400, /Extra deduction 1: The end date/],
  ["extra: no name", { ...base, extra_commissions: [{ ...ex, name: "  " }] }, 400, /name/],
  ["21 extras", { ...base, extra_commissions: Array(21).fill(ex) }, 400],
  ["intercom without a line", { ...base, intercom_id: "00000000-0000-0000-0000-000000000000" }, 400, /line/],
  ["Reg No. already used", { ...base, employee_code: 1430 }, 409, /Reg No/],
  ["email already used", { ...base, email: "neha@crm-demo.local" }, 409, /Email/],
];
for (const [name, body, status, re] of bad) {
  const r = await call(owner, "POST", "/employees", body);
  ok(r.status === status && (!re || re.test(r.msg)), `refuses ${name} (${status})`, `got ${r.status} ${r.msg}`);
}
const leftovers = (await call(owner, "GET", "/employees")).data.filter((u) => u.email.startsWith(`e2e${stamp}`) || u.email.startsWith(`x${stamp}`));
ok(leftovers.length === 0, "no user was created by a refused request");

// ── a valid user with salary, line, an unlinked intercom, targets, tabs and extras ──
const lines = (await call(owner, "GET", "/lines")).data;
const ics = (await call(owner, "GET", "/intercoms")).data;
ok(ics.length === 10, "10 intercoms exist", `got ${ics.length}`);
// a line nobody holds, so the test never moves a demo user's line
const freeLine = (await pool.query("INSERT INTO lines (line_number) VALUES ('99') ON CONFLICT (line_number) DO UPDATE SET employee_id = NULL RETURNING id, line_number")).rows[0];
const icBefore = (await pool.query("SELECT id, line_number FROM intercoms")).rows;
const ic608 = ics.find((i) => i.intercom_code === "608"), ic609 = ics.find((i) => i.intercom_code === "609");
const full = { ...base, phone: "98765 43210".replace(" ", ""), designation: "Call Rep.", fix_salary: 12000, trial_commission: 20, trial_commission_type: "pct",
  regular_commission: 500, regular_commission_type: "fix", target_call_secs: 21600, target_trial: 2, target_regular: 1,
  permissions: ["crm_leads", "recordings"], line_id: freeLine.id, intercom_id: ic608.id,
  extra_commissions: [ex, { ...ex, name: "Old rule", counts: "fee", reward: "pct", days: [], hours: null }], extra_deductions: [dd, { ...dd, name: "Fine", type: "fix", amount: 500 }] };
const created = await call(owner, "POST", "/employees", full);
ok(created.status === 201, "creates a valid user", `${created.status} ${created.msg}`);
const u = created.data;
ok(u?.fix_salary === 12000 && u?.trial_commission === 20 && u?.trial_commission_type === "pct", "salary fields saved");
ok(u?.extra_commissions?.length === 2 && !("counts" in u.extra_commissions[1]), "extra commissions saved, old rule fields stripped");
ok(u?.extra_deductions?.length === 2 && u.extra_deductions[1].amount === 500, "extra deductions saved");
ok(u?.line_id === freeLine.id && u?.intercom_id === ic608.id, "line and intercom saved");
let ic = (await call(owner, "GET", "/intercoms")).data;
ok(ic.find((i) => i.id === ic608.id).line_number === freeLine.line_number, "intercom 608 moved onto the user's line");

const sw = await call(owner, "PATCH", `/employees/${u.id}`, { intercom_id: ic609.id });
ic = (await call(owner, "GET", "/intercoms")).data;
ok(sw.status === 200 && ic.find((i) => i.id === ic609.id).line_number === freeLine.line_number && !ic.find((i) => i.id === ic608.id).line_number,
  "switching intercom frees the old one (one intercom per line)");
const ed = await call(owner, "PATCH", `/employees/${u.id}`, { extra_commissions: [] });
ok(ed.status === 200 && ed.data.extra_commissions.length === 0, "extras can be cleared");
await call(owner, "PATCH", `/employees/${u.id}`, { extra_commissions: full.extra_commissions });

// ── the new user: login, tabs, data scope ──
const rep = (await login(base.email, base.password)).token;
const me = (await call(rep, "GET", "/auth/me")).data;
ok(me?.role === "employee" && me.permissions.includes("recordings") && !me.permissions.includes("users"), "new user signs in with the ticked tabs");
ok((await call(rep, "GET", "/employees")).status === 403, "User without the Users tab can't list users");
ok((await call(rep, "GET", `/employees/${u.id}`)).data?.extra_commissions?.length === 2, "User reads own salary and extras");
const nehaId = (await call(neha, "GET", "/auth/me")).data.id;
ok((await call(rep, "GET", `/employees/${nehaId}`)).status === 403, "User can't read someone else's record");
ok((await call(rep, "GET", "/calls?limit=1")).status === 200, "Recordings ticked → calls API open");
ok((await call(rep, "GET", "/reports/schedules")).status === 403, "Reports not ticked → email schedules refused");
ok((await call(rep, "GET", "/students")).status === 403, "Payments not ticked → refused");
ok((await call(rep, "PATCH", `/lines/${freeLine.id}`, { purpose: null })).status === 403, "Intercoms not ticked → can't set a line's person");
ok((await call(owner, "PATCH", `/lines/${freeLine.id}`, { purpose: null })).status === 200, "Super Admin can edit a line");
const rd = (await call(rep, "GET", "/reports/data?employee_id=all")).data;
ok(rd && (rd.people ?? []).every((p) => p.id === undefined || p.id === u.id), "User's report is only their own");
const sm = (await call(rep, "GET", "/employees/me/summary")).data;
ok(sm?.extra_deductions?.length === 2 && sm.extra_commissions?.length === 2, "My Dashboard summary carries extras and deductions");
ok((await call(rep, "GET", `/employees/${nehaId}/summary`)).status === 403, "User can't open someone else's dashboard");
{ // the targets box follows the day picked: Yesterday shows yesterday's targets, a week shows today's
  const d = (await pool.query("SELECT to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1, 'YYYY-MM-DD') AS y, to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date - 6, 'YYYY-MM-DD') AS w, to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS t")).rows[0];
  const y = (await call(rep, "GET", `/employees/me/summary?date_from=${d.y}&date_to=${d.y}`)).data?.today;
  ok(y?.date === d.y && y.is_today === false, "targets box: Yesterday picked → yesterday's targets", JSON.stringify(y));
  const w = (await call(rep, "GET", `/employees/me/summary?date_from=${d.w}&date_to=${d.t}`)).data?.today;
  ok(w?.date === d.t && w.is_today === true, "targets box: a longer period → today's targets", JSON.stringify(w));
}
const eye = await call(owner, "GET", `/employees/${u.id}/summary`);
ok(eye.status === 200 && eye.data.name === base.name, "Super Admin's eye opens the user's dashboard");
ok((await call(owner, "GET", "/employees/not-a-uuid/summary")).status === 404, "eye with a bad id → 404");
ok(sm?.line_number === freeLine.line_number && sm?.intercom_code === "609" && sm?.target_trial === 2, "My Dashboard header: line, intercom, targets");

// ── payments from the school site (API must run with PAYMENTS_API_URL=http://127.0.0.1:4100 PAYMENTS_API_KEY=mock-key) ──
const mock = await startMock(4100);
const nov = "date_from=2026-11-01&date_to=2026-11-30";
const ps = (await call(rep, "GET", `/employees/me/summary?${nov}`)).data;
if (!ps?.payments?.connected) {
  console.log(`SKIP  payments checks: the API is not pointed at the mock (${ps?.payments?.error ?? "not connected"})`);
} else {
  // test user: trial 20 % of fee, regular ₹500 each
  ok(ps.payments.list.length === 105, "all pages of payments read (105 across 2 pages)", `got ${ps.payments.list.length}`);
  ok(ps.income.trial === 100 && ps.income.trial_count === 1, "trial commission = 20 % of ₹500", JSON.stringify(ps.income));
  ok(ps.income.regular === 52000 && ps.income.regular_count === 104, "regular commission = 104 × ₹500", JSON.stringify(ps.income));
  // the dashboard's pay is the tracker's number: 12000 + 52100 + 200 − (10 % of salary + commission 64100 + ₹500) = 57390
  ok(ps.pay?.month === "2026-11" && ps.pay.total === 57390, "dashboard month pay = tracker payout (extras added, deductions taken off)", JSON.stringify(ps.pay));
  ok(ps.payments.list.find((x) => x.id === "p2")?.receipt_url === null, "a javascript: receipt link is dropped");
  ok(ps.payments.list.find((x) => x.id === "p3")?.receipt_url?.startsWith("https://"), "an https receipt link is kept");
  ok(!JSON.stringify(ps.payments).includes("9000000000"), "student phone numbers are not passed to the browser");
  const oct = (await call(rep, "GET", "/employees/me/summary?date_from=2026-10-01&date_to=2026-10-31")).data;
  ok(oct.payments.list.length === 0 && oct.income.total === 0, "another month shows no November payments");
  // Payments tab: read only, everyone's for the Super Admin, own only for a User
  const P = "/payments?from=2026-11-01&to=2026-11-30";
  ok((await call(rep, "GET", P)).status === 403, "Payments tab: not ticked → refused");
  const op = await call(owner, "GET", P);
  ok(op.status === 200 && op.data.payments.length === 105 && op.data.payments[0].paid_date === "2026-11-20", "Payments tab: every payment, newest first", `${op.status} ${op.data?.payments?.length}`);
  ok(op.data?.payments.find((x) => x.id === "p2")?.receipt_url === null && op.data.payments[0].phone === "9000000000", "Payments tab: phone shown, javascript: receipt dropped");
  ok((await call(owner, "GET", "/payments?from=2026-11-30&to=2026-11-01")).status === 400, "Payments tab: start after end → 400");
  const all = await call(owner, "GET", "/payments");
  ok(all.status === 200 && all.data.payments.length === 105 && all.data.from === "" && all.data.to === "", "Payments tab: no dates → every payment so far", `${all.status} ${all.data?.payments?.length}`);
  ok((await call(owner, "GET", "/payments?from=2026-11-10")).data?.payments?.length === 103, "Payments tab: only a start date → from that day on");
  ok((await call(owner, "GET", "/payments?from=11-10-2026")).status === 400, "Payments tab: a bad date → 400");
  mock.broken.add(nehaId);
  // another period, so the 2-minute cache doesn't answer from the good read above
  ok((await call(owner, "GET", "/payments?from=2026-11-02&to=2026-11-30")).data?.missing?.some((m) => /unexpected shape/.test(m.error)), "Payments tab: a rep whose payments fail is named, the rest still load");
  await call(owner, "PATCH", `/employees/${u.id}`, { permissions: [...me.permissions, "payments"] });
  const rp = await call(rep, "GET", "/payments?from=2026-11-02&to=2026-11-30");
  ok(rp.status === 200 && rp.data.payments.length === 105 && rp.data.missing.length === 0, "Payments tab: a User asks only for their own", JSON.stringify(rp.data?.missing));
  // payment status codes 1, 2, 3…: every payment starts on 1; Admins and the Super Admin change them
  await pool.query("DELETE FROM payment_status WHERE payment_id IN ('p1', 'p2', 'p3')");
  ok(op.data.codes?.["1"] && op.data.payments.every((x) => x.status === "1"), "payment status: every payment starts on 1");
  ok((await call(owner, "PATCH", "/crm/settings/values/pay_codes", { 1: { label: "New" }, 2: { label: "Checked", color: "#22aa55" } })).status === 200, "payment status: codes 1 and 2 named");
  ok((await call(owner, "PATCH", "/crm/settings/values/pay_codes", { A: { label: "x" } })).status === 400, "payment status: a letter code is refused");
  ok((await call(owner, "PATCH", "/payments/p3/status", { code: "2" })).status === 200, "payment status: Super Admin sets 2");
  ok((await call(owner, "PATCH", "/payments/p3/status", { code: "77" })).status === 400, "payment status: a code not set up is refused");
  ok((await call(rep, "PATCH", "/payments/p3/status", { code: "1" })).status === 403, "payment status: a User can't change it");
  const gp = (await call(rep, "GET", "/payments?from=2026-11-03&to=2026-11-30")).data;
  ok(gp?.payments.find((x) => x.id === "p3")?.status === "2" && gp.codes["2"]?.color === "#22aa55", "payment status: the new code and its colour come back");
  await pool.query("DELETE FROM payment_status WHERE payment_id IN ('p1', 'p2', 'p3')");
  await call(owner, "PATCH", `/employees/${u.id}`, { permissions: me.permissions });
  mock.broken.delete(nehaId);

  mock.broken.add((await call(owner, "GET", "/auth/me")).data.id);
  const ob = await call(owner, "GET", `/employees/me/summary?${nov}`);
  ok(ob.status === 200 && ob.data.payments.connected === false && /unexpected shape/.test(ob.data.payments.error), "a broken payments answer shows an error, the page still loads", JSON.stringify(ob.data?.payments));
  const pr = await call(owner, "GET", "/employees/payroll?month=2026-11");
  const mine = pr.data?.people?.find((x) => x.id === u.id);
  // 12000 + (100 + 52000) + 2 extras × ₹100 = 64300 − (10 % of salary + commission 64100 + ₹500) (client, 15 Nov 2026)
  ok(pr.status === 200 && mine?.total === 57390, "month payout = base + commission + extras − deductions", JSON.stringify(mine));
  ok(mine && !("extra_commissions" in mine) && mine.deductions.length === 2 && mine.extras.length === 2, "payroll row lists the extras and deductions applied");
  ok((await call(owner, "GET", "/employees/payroll?month=2026-13")).status === 400, "payroll: bad month → 400");
  const ownerId = (await call(owner, "GET", "/auth/me")).data.id;
  const ownRow = pr.data?.people?.find((x) => x.id === ownerId);
  ok(ownRow && ownRow.error === null && !("role" in ownRow), "Employee Tracker lists the Owner when the school site knows them", JSON.stringify(ownRow && { error: ownRow.error }));
  ok(!pr.data?.people?.some((x) => x.isOwner && x.error), "an owner account the school site doesn't know is left out");
  ok((await call(rep, "GET", "/employees/payroll")).status === 403, "payroll: a User is refused");
}

await call(owner, "PATCH", `/employees/${u.id}`, { permissions: ["crm_leads"] });
ok((await call(rep, "GET", "/calls?limit=1")).status === 403, "unticking Recordings applies at once");

// ── ranks ──
await call(owner, "PATCH", `/employees/${u.id}`, { role: "admin", permissions: ["users", "recordings"] });
const adm = (await login(base.email, base.password)).token;
ok((await call(adm, "GET", "/employees/payroll")).status === 403, "payroll: an Admin is refused (Super Admin only)");
// the Users form lists and creates teams for a Users-tab holder; changing or deleting stays on the Teams tab
ok((await call(adm, "GET", "/teams")).status === 200, "Users tab alone can list teams (the form's team picker)");
{ // Teams: the numbers cover the period asked for; none given = today
  const tot = (r) => [...r.data.teams.flatMap((t) => t.members), ...r.data.unassigned].reduce((n, x) => n + x.calls_today, 0);
  const dayAgo = (n) => pool.query("SELECT to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date - $1::int, 'YYYY-MM-DD') AS d", [n]).then((r) => r.rows[0].d);
  const [today, old] = [await dayAgo(0), await dayAgo(4000)];
  const dflt = await call(owner, "GET", "/teams"), todayR = await call(owner, "GET", `/teams?date_from=${today}&date_to=${today}`);
  ok(dflt.status === 200 && tot(dflt) === tot(todayR), "teams: no dates = today", `${tot(dflt)} vs ${tot(todayR)}`);
  const everything = await call(owner, "GET", "/teams?date_from=2000-01-01");
  const longAgo = await call(owner, "GET", `/teams?date_from=${old}&date_to=${old}`);
  ok(tot(everything) >= tot(todayR) && tot(longAgo) === 0, "teams: a wider period counts at least today's calls; a day long ago has none", `${tot(everything)} / ${tot(longAgo)}`);
}
const mk = await call(adm, "POST", "/teams", { name: `E2E Team ${stamp}`, location: "Sector 17, Chandigarh" });
ok(mk.status === 201 && mk.data?.location === "Sector 17, Chandigarh", "Users tab alone can create a team (name + office address)", `${mk.status} ${mk.msg}`);
ok((await call(adm, "DELETE", `/teams/${mk.data?.id}`)).status === 403, "…but can't delete it without the Teams tab");
await call(owner, "DELETE", `/teams/${mk.data?.id}`);
ok((await call(adm, "POST", "/employees", { ...base, email: `y${stamp}@crm-demo.local`, role: "owner" })).status === 403, "Admin can't create a Super Admin");
const ownerId = (await call(owner, "GET", "/auth/me")).data.id;
ok((await call(adm, "PATCH", `/employees/${ownerId}`, { name: "x" })).status === 403, "Admin can't edit a Super Admin");
ok((await call(adm, "PATCH", `/employees/${u.id}`, { role: "employee" })).status === 403, "nobody changes their own rank");
ok((await call(owner, "PATCH", `/employees/${ownerId}`, { status: "inactive" })).status === 403, "Super Admin can't switch themselves off");
ok((await call(adm, "GET", "/calls?limit=1")).data?.data !== undefined, "Admin with Recordings sees calls");

ok((await call(adm, "PATCH", `/employees/${u.id}`, { permissions: ["users", "recordings", "payments"] })).status === 403, "Admin can't give themselves more tabs");
await call(owner, "PATCH", `/employees/${u.id}`, { role: "employee" });
// same session, no new login: a User sees only their own calls, and this test user has none
ok((await call(adm, "GET", "/calls?limit=1")).data?.total === 0, "a demoted Admin sees only their own calls at once, same session");
await call(owner, "PATCH", `/employees/${u.id}`, { role: "admin" });

// ── switch off ──
await call(owner, "PATCH", `/employees/${u.id}`, { status: "inactive" });
ok((await login(base.email, base.password)).status === 401, "inactive user can't sign in");
ok((await call(adm, "GET", "/auth/me")).status === 401, "inactive user's open session stops working");
// Employee Tracker keeps someone switched off this month: greyed, salary for the days worked; not the month after
{
  const today = (await pool.query("SELECT to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
  const [y, m] = today.split("-").map(Number);
  const ym = (yy, mm) => `${yy + Math.floor((mm - 1) / 12)}-${String(((mm - 1) % 12 + 12) % 12 + 1).padStart(2, "0")}`;
  const row = async (month) => (await call(owner, "GET", `/employees/payroll?month=${month}`)).data?.people?.find((x) => x.id === u.id);
  const now = await row(today.slice(0, 7));
  const days = Number(today.slice(8)), monthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  ok(now?.left_on === today && now.days_paid === days && now.base === Math.round(12000 * days / monthDays), "tracker: switched off today → listed this month, salary for the days worked", JSON.stringify(now && { left_on: now.left_on, days_paid: now.days_paid, base: now.base }));
  ok(!(await row(ym(y, m + 1))), "tracker: not listed the month after leaving");
  const before = await row(ym(y, m - 1));
  ok(before && before.left_on === null && before.base === 12000, "tracker: the month before leaving shows as usual");
  await call(owner, "PATCH", `/employees/${u.id}`, { status: "active" });
  ok((await pool.query("SELECT left_on FROM employees WHERE id = $1", [u.id])).rows[0].left_on === null, "switching back on clears the leaving day");
  await call(owner, "PATCH", `/employees/${u.id}`, { status: "inactive" });
}

// ── removed / other endpoints ──
ok((await call(owner, "GET", "/analytics/overview")).status === 404, "Dashboard API removed");
ok((await call(owner, "PATCH", "/crm/settings/values/codes", { A: { label: "Not picked", role: "retry", hours: 3, color: "red" } })).status === 400, "code colour must be #rrggbb");
const taken = ics.find((i) => i.line_number && i.id !== ic608.id && i.id !== ic609.id);
const other = ics.find((i) => i.intercom_code === "610");
ok((await call(owner, "PATCH", `/intercoms/${other.id}`, { phone_number: other.phone_number, line_number: taken.line_number })).status === 409, "two intercoms can't share a line");
const lead = (await call(owner, "GET", "/crm/leads?limit=1")).data.data[0];
ok((await call(owner, "POST", `/crm/leads/${lead.id}/whatsapp`, { template: "no_such_template_x", values: {} })).status === 404, "WATI: unknown template refused");
ok((await call(owner, "POST", `/crm/leads/${lead.id}/whatsapp`, { template: "10_days_299", values: {} })).status === 400, "WATI: empty blank refused");
ok((await call(owner, "POST", `/crm/leads/${lead.id}/whatsapp`, { template: "10_days_299", values: { name: "Test" } })).data?.mode === "dry-run", "WATI: local send is dry-run only");


// ── line rules (client, 15 Nov 2026): one person per line; switching off frees the line; gap calls; swap ──
{
  const mk = async (tag) => (await call(owner, "POST", "/employees", { name: `LR ${tag}`, email: `lr${tag}${stamp}@crm-demo.local`, password: "Lr@123456", permissions: ["recordings"] })).data;
  const [ua, ub] = [await mk("a"), await mk("b")];
  // "Show saved password" (client, 15 Nov 2026): encrypted copy, Super Admin only, Users and Admins only
  const reveal = (tok, id) => call(tok, "GET", `/employees/${id}/password`);
  const adminU = (await call(owner, "POST", "/employees", { name: "LR admin", email: `lrx${stamp}@crm-demo.local`, password: "Lr@123456", role: "admin", permissions: ["users"] })).data;
  const admTok = (await login(`lrx${stamp}@crm-demo.local`, "Lr@123456")).token;
  const r1 = await reveal(owner, ua.id);
  ok(r1.status === 200 && r1.data.status === "ok" && r1.data.password === "Lr@123456", "saved password: the Super Admin sees a new user's password", JSON.stringify(r1.data));
  const row = (await pool.query("SELECT password_enc, password_hash FROM employees WHERE id = $1", [ua.id])).rows[0];
  ok(row.password_enc.startsWith("v1:") && !row.password_enc.includes("Lr@123456") && row.password_hash.startsWith("$2"), "saved password: stored encrypted (not plain text), login hash unchanged");
  ok(!JSON.stringify((await call(owner, "GET", "/employees")).data).includes("password"), "saved password: no password field in the user list");
  ok((await reveal(neha, ua.id)).status === 403 && (await reveal(admTok, ua.id)).status === 403, "saved password: only the Super Admin (a User and an Admin are refused)");
  const oid = (await call(owner, "GET", "/auth/me")).data.id;
  const own = await reveal(owner, oid);
  ok(own.status === 200 && ["ok", "not_saved"].includes(own.data.status), "saved password: a Super Admin can ask for their own", JSON.stringify(own.data && { s: own.data.status }));
  const other = (await call(owner, "POST", "/employees", { name: "LR owner", email: `lro${stamp}@crm-demo.local`, password: "Lr@123456", role: "owner" })).data;
  const otherTok = (await login(`lro${stamp}@crm-demo.local`, "Lr@123456")).token;
  ok((await reveal(owner, other.id)).status === 403, "saved password: …but not another Super Admin's");
  const mine = await reveal(otherTok, other.id);
  ok(mine.status === 200 && mine.data.password === "Lr@123456", "saved password: …and that Super Admin sees their own", JSON.stringify(mine.data));
  await call(owner, "PATCH", `/employees/${ub.id}`, { password: "Changed@12345" });
  ok((await reveal(owner, ub.id)).data.password === "Changed@12345" && (await login(`lrb${stamp}@crm-demo.local`, "Changed@12345")).status === 200, "saved password: a changed password shows the new one and logs in");
  await pool.query("UPDATE employees SET password_enc = NULL WHERE id = $1", [ub.id]);
  ok((await reveal(owner, ub.id)).data.status === "not_saved", "saved password: no copy yet → says so");
  const L = {};
  for (const n of ["97", "98"]) L[n] = (await pool.query("INSERT INTO lines (line_number) VALUES ($1) ON CONFLICT (line_number) DO UPDATE SET employee_id = NULL, freed_at = NULL RETURNING id", [n])).rows[0].id;
  const spare = (await call(owner, "GET", "/intercoms")).data.filter((i) => !i.line_number && i.phone_number).slice(0, 1)[0];
  const lineOf = async (n) => (await call(owner, "GET", "/lines")).data.find((l) => l.line_number === n);

  ok((await call(owner, "PATCH", `/lines/${L["97"]}`, { employee_id: ua.id })).status === 200, "line rules: an active person is put on a free line");
  const two = await call(owner, "PATCH", `/lines/${L["98"]}`, { employee_id: ua.id });
  ok(two.status === 409 && /already has line 97/.test(two.msg), "line rules: one line per person", `${two.status} ${two.msg}`);
  const taken = await call(owner, "PATCH", `/employees/${ub.id}`, { line_id: L["97"] });
  ok(taken.status === 400 && /is with LR a/.test(taken.msg), "line rules: a line another person holds can't be taken (Users form)", `${taken.status} ${taken.msg}`);

  // swap: needs two lines with agents; past calls are not touched
  await call(owner, "PATCH", `/lines/${L["98"]}`, { employee_id: ub.id });
  const sw = await call(owner, "POST", "/lines/swap", { a: L["97"], b: L["98"] });
  ok(sw.status === 200 && (await lineOf("97")).employee_id === ub.id && (await lineOf("98")).employee_id === ua.id, "swap: the two lines trade agents", `${sw.status} ${sw.msg}`);
  ok((await call(owner, "POST", "/lines/swap", { a: L["97"], b: L["97"] })).status === 400, "swap: the same line twice is refused");
  const nn = await call(neha, "POST", "/lines/swap", { a: L["97"], b: L["98"] });
  ok(nn.status === 403, "swap: needs the Intercoms tab", `${nn.status}`);

  // an intercom on line 97, then its person is switched off: line free, intercom off the line, number kept
  if (spare) {
    await call(owner, "PATCH", `/intercoms/${spare.id}`, { phone_number: spare.phone_number, line_number: "97" });
    // the call details show the intercom and calling number on the call's line when the file name has none
    const cid = (await pool.query("INSERT INTO calls (source_file_key, line_number, called_at, duration_secs, call_direction, caller_phone, employee_id) VALUES ($1, '97', NOW(), 20, 'outbound', '9876500002', $2) RETURNING id", [`e2e/${stamp}/d.wav`, ub.id])).rows[0].id;
    const det = (await call(owner, "GET", `/calls/${cid}`)).data;
    ok(det?.intercom_code === spare.intercom_code && det?.intercom_phone_number === spare.phone_number, "call details: the line's intercom and calling number are shown", JSON.stringify(det && { c: det.intercom_code, p: det.intercom_phone_number }));
    await call(owner, "PATCH", `/employees/${ub.id}`, { status: "inactive" });
    const l97 = await lineOf("97");
    const icAfter = (await call(owner, "GET", "/intercoms")).data.find((i) => i.id === spare.id);
    ok(l97.employee_id === null && l97.freed_at !== null, "switching a person off frees their line");
    ok(icAfter.line_number === null && icAfter.phone_number === spare.phone_number, "…the intercom leaves the line but keeps its calling number");
  }

  // calls that arrive on a free line have no agent; the next agent can be given them
  const t0 = (await lineOf("97")).freed_at;
  await pool.query("INSERT INTO calls (source_file_key, line_number, called_at, duration_secs, call_direction, caller_phone) VALUES ($1, '97', NOW(), 30, 'outbound', '9876500000'), ($2, '97', NOW(), 5, 'outbound', '9876500001')",
    [`e2e/${stamp}/a.wav`, `e2e/${stamp}/b.wav`]);
  ok((await lineOf("97")).gap_calls === 2, "a free line counts the calls that came with no agent (short ones too)", String((await lineOf("97")).gap_calls));
  const none = await call(owner, "PATCH", `/employees/${ua.id}`, { status: "inactive" });
  const sick = await call(owner, "PATCH", `/lines/${L["97"]}`, { employee_id: ua.id });
  ok(sick.status === 400 && /switched off/.test(sick.msg), "a switched-off person can't be put on a line", `${sick.status} ${sick.msg}`);
  await call(owner, "PATCH", `/employees/${ua.id}`, { status: "active" });
  ok((await lineOf("98")).employee_id === null, "…and her line 98 was freed when she was switched off (back on does not re-attach)");
  const give = await call(owner, "PATCH", `/lines/${L["97"]}`, { employee_id: ua.id, claim_gap: true });
  ok(give.status === 200 && give.data.claimed === 2, "giving the free line to an agent can give her the gap calls", JSON.stringify(give.data));
  ok((await pool.query("SELECT COUNT(*)::int n FROM calls WHERE source_file_key LIKE $1 AND employee_id = $2", [`e2e/${stamp}/%`, ua.id])).rows[0].n === 2 && (await lineOf("97")).gap_calls === 0, "…and the warning count goes to 0");

  await pool.query("DELETE FROM calls WHERE source_file_key LIKE $1", [`e2e/${stamp}/%`]);
  await pool.query("DELETE FROM lines WHERE id = ANY($1)", [Object.values(L)]);
  await pool.query("DELETE FROM employees WHERE id = ANY($1)", [[ua.id, ub.id, adminU.id, other.id]]);
  if (spare) await pool.query("UPDATE intercoms SET line_number = NULL WHERE id = $1", [spare.id]);
}

// ── Daily salary from targets (docs/salary-commission/EMPLOYEE-PAYMENT-FLOW.md) ──────────────────────────────────
// A fixed, hand-worked month: November 2026, "today" pinned to Sat 21 Nov (as_of works only outside production).
// Mon–Sat working, 11 Nov a holiday → 24 working days; ₹24,000 salary → ₹1,000 a day. Targets: 1 h calling, 1 trial,
// 2 regular, all ticked → each is ⅓ of the day. Mock payments: 3 Nov Trial ₹500 · 5 Nov ₹2,999.50 · 10 Nov ₹4,000 ·
// 20 Nov 102 × ₹10 (regular).
{
  const t0 = new Date().toISOString();
  const AS = "as_of=2026-11-21";
  const settingsBefore = (await call(owner, "GET", "/pay/settings")).data;
  const get = (tok, path) => call(tok, "GET", path);

  // ── settings and holidays: validation and rights ──
  ok((await call(owner, "PUT", "/pay/settings", { weekdays: [], daily_pay_from: null })).status === 400, "daily pay: at least one working day");
  ok((await call(owner, "PUT", "/pay/settings", { weekdays: [1, 1], daily_pay_from: null })).status === 400, "daily pay: a weekday twice is refused");
  ok((await call(owner, "PUT", "/pay/settings", { weekdays: [1, 2, 3, 4, 5, 6], daily_pay_from: "2026-13" })).status === 400, "daily pay: a bad start month is refused");
  ok((await call(neha, "PUT", "/pay/settings", { weekdays: [1, 2, 3, 4, 5, 6], daily_pay_from: null })).status === 403, "daily pay: only the Super Admin changes working days");
  ok((await call(owner, "PUT", "/pay/settings", { weekdays: [1, 2, 3, 4, 5, 6], daily_pay_from: null })).status === 200, "daily pay: working days Mon–Sat saved, daily pay Off");
  await pool.query("DELETE FROM holidays WHERE day = '2026-11-11'");
  ok((await call(owner, "POST", "/pay/holidays", { day: "2026-02-30", name: "x" })).status === 400, "holiday: an impossible date is refused");
  ok((await call(owner, "POST", "/pay/holidays", { day: "2026-11-11", name: " " })).status === 400, "holiday: needs a name");
  ok((await call(neha, "POST", "/pay/holidays", { day: "2026-11-11", name: "Test holiday" })).status === 403, "holiday: only the Super Admin adds one");
  ok((await call(owner, "POST", "/pay/holidays", { day: "2026-11-11", name: "Test holiday" })).status === 201, "holiday: 11 Nov added");
  ok((await call(owner, "POST", "/pay/holidays", { day: "2026-11-11", name: "Again" })).status === 409, "holiday: the same date twice is refused");
  const st = (await get(owner, "/pay/settings?month=2026-11")).data;
  ok(st.working_days === 24 && st.daily === false, "working days: November 2026 = 30 − 5 Sundays − 1 holiday = 24", JSON.stringify({ w: st.working_days, d: st.daily }));

  // ── the rep: salary, commission, targets with ticks, joining date, extras and deductions ──
  const dp = await call(owner, "POST", "/employees", { name: "DP Rep", email: `dp${stamp}@crm-demo.local`, password: "Dp@123456", permissions: ["recordings"],
    fix_salary: 24000, trial_commission: 100, trial_commission_type: "fix", regular_commission: 10, regular_commission_type: "pct",
    target_call_secs: 3600, target_trial: 1, target_regular: 2, tick_call: true, tick_trial: true, tick_regular: true, join_date: "2026-11-02",
    extra_commissions: [{ name: "Bonus", amount: 500, from: "2026-11-10", to: "2026-11-10" }, { name: "Later bonus", amount: 700, from: "2026-11-25", to: "2026-11-25" }],
    extra_deductions: [{ name: "Late", type: "pct", amount: 5, from: "2026-11-04", to: "2026-11-04" }, { name: "Later fine", type: "fix", amount: 300, from: "2026-11-22", to: "2026-11-22" }] });
  ok(dp.status === 201 && dp.data.tick_call === true && dp.data.tick_trial === true && dp.data.join_date === "2026-11-02", "Users form: target ticks and joining date saved", `${dp.status} ${dp.msg}`);
  ok((await call(owner, "PATCH", `/employees/${dp.data.id}`, { join_date: "2026-11-31" })).status === 400, "Users form: an impossible joining date is refused");
  const rid = dp.data.id;
  const repTok = (await login(`dp${stamp}@crm-demo.local`, "Dp@123456")).token;
  // calls (IST): 2 Nov 1 h · 3 Nov 30 min · 4 Nov 45 min · 7 Nov 1 h · 9 Nov 1 h · 10 Nov 1 h · 11 Nov (holiday) 1 h · 21 Nov (today) 1 h
  const C = [["2026-11-02", 3600], ["2026-11-03", 1800], ["2026-11-04", 2700], ["2026-11-07", 3600], ["2026-11-09", 3600], ["2026-11-10", 3600], ["2026-11-11", 3600], ["2026-11-21", 3600]];
  for (const [d, secs] of C) {
    await pool.query("INSERT INTO calls (source_file_key, called_at, duration_secs, call_direction, caller_phone, employee_id) VALUES ($1, $2, $3, 'outbound', '9876500100', $4)",
      [`e2e/${stamp}/dp-${d}.wav`, `${d} 10:00:00+05:30`, secs, rid]);
  }
  // days close in order, as in production (the closer runs every few minutes): up to 8 Nov first
  await pool.query("DELETE FROM day_targets WHERE day >= '2026-10-01'");
  await pool.query("DELETE FROM pay_settings WHERE key IN ('closed_from', 'closed_through')");
  ok((await call(owner, "POST", "/pay/dev/close-days", { today: "2026-11-01" })).status === 200 && (await call(owner, "POST", "/pay/dev/close-days", { today: "2026-11-09" })).data.closed > 0, "closing days: 31 Oct – 8 Nov saved");
  ok((await pool.query("SELECT COUNT(*)::int n FROM day_targets WHERE employee_id = $1 AND day BETWEEN '2026-11-01' AND '2026-11-08'", [rid])).rows[0].n === 7, "closing days: the rep has 2–8 Nov saved (not 1 Nov, before her joining date)");
  // 9 Nov was closed with a 2 h calling target and only calling ticked (the target was changed after): it keeps those
  await pool.query("INSERT INTO day_targets (employee_id, day, target_call_secs, target_trial, target_regular, tick_call, tick_trial, tick_regular) VALUES ($1, '2026-11-09', 7200, 1, 2, true, false, false)", [rid]);

  // ── daily pay Off: the old rule (full fixed salary for the month) ──
  const off = (await get(owner, `/employees/payroll?month=2026-11&${AS}`)).data.people.find((x) => x.id === rid);
  ok(off?.mode === "monthly" && off.base === 24000, "daily pay Off: November keeps the full-month rule", JSON.stringify(off && { m: off.mode, b: off.base }));

  ok((await call(owner, "PUT", "/pay/settings", { weekdays: [1, 2, 3, 4, 5, 6], daily_pay_from: "2026-11" })).status === 200, "daily pay switched on from November 2026");
  ok((await call(owner, "PUT", `/pay/overrides?${AS}`, { employee_id: rid, day: "2026-11-06", full: true })).status === 200, "count as full: 6 Nov (no calls recorded)");
  ok((await call(owner, "PUT", `/pay/overrides?${AS}`, { employee_id: rid, day: "2026-11-25", full: true })).status === 400, "count as full: not a day that hasn't happened");
  ok((await call(owner, "PUT", `/pay/overrides?${AS}`, { employee_id: rid, day: "2026-11-08", full: true })).status === 400, "count as full: not a Sunday");
  ok((await call(owner, "PUT", `/pay/overrides?${AS}`, { employee_id: rid, day: "2026-11-11", full: true })).status === 400, "count as full: not a holiday");
  ok((await call(repTok, "PUT", `/pay/overrides?${AS}`, { employee_id: rid, day: "2026-11-12", full: true })).status === 403, "count as full: only the Super Admin");

  // expected, worked by hand (paise; ₹1,000 a day = 100000):
  const want = {
    "2026-11-02": 33333,  // calling 100 %, trial 0, regular 0 → ⅓
    "2026-11-03": 50000,  // calling 50 % (½ of ⅓) + trial 1/1 (⅓) → ½
    "2026-11-04": 25000,  // calling 75 % → ¾ of ⅓ = ¼
    "2026-11-05": 16667,  // regular 1 of 2 = 50 % → ½ of ⅓ = ⅙
    "2026-11-06": 100000, // counted as full
    "2026-11-07": 33333,  // calling 100 % → ⅓
    "2026-11-09": 50000,  // its saved targets: only calling, 1 h of 2 h = 50 % → ½
    "2026-11-10": 50000,  // calling 100 % (⅓) + regular 1 of 2 (½ of ⅓) → ½
    "2026-11-20": 33333,  // 102 regular payments → regular 100 % → ⅓
    "2026-11-21": 33333,  // today, live: calling 1 h → ⅓
  };
  const salaryPaise = Object.values(want).reduce((a, b) => a + b, 0);   // 424999 = ₹4,249.99
  // commission: 1 trial × ₹100 + 10 % of (2,999.50 + 4,000 + 1,020) = ₹801.95 → ₹802; extras ₹500 (10 Nov);
  // deduction 5 % of salary + commission (client, 15 Nov 2026): 5 % of (4,249.99 + 902 = 5,151.99) = ₹257.60 → ₹258
  const total = (salaryPaise + 100 * (100 + 802 + 500 - 258)) / 100;     // ₹5,393.99

  const days = await get(owner, `/pay/days?employee_id=${rid}&month=2026-11&${AS}`);
  const D = days.data;
  ok(days.status === 200 && D.mode === "daily" && D.working_days === 24 && D.days_so_far === 17, "Days view: daily rule, 24 working days, 17 so far (2–21 Nov without 2 Sundays and the holiday)", JSON.stringify({ s: days.status, m: D?.mode, w: D?.working_days, n: D?.days_so_far }));
  const kind = (d) => D.days.find((x) => x.day === d);
  const wrong = Object.entries(want).filter(([d, p]) => kind(d)?.paise !== p).map(([d, p]) => `${d}: got ${kind(d)?.paise} want ${p}`);
  ok(wrong.length === 0, "Days view: every day's ₹ matches the hand-worked figure", wrong.join("; "));
  const zero = D.days.filter((x) => x.kind === "working" && !(x.day in want) && x.paise !== 0).map((x) => x.day);
  ok(zero.length === 0 && ["2026-11-12", "2026-11-19"].every((d) => kind(d).kind === "working" && kind(d).paise === 0), "Days view: working days with nothing done earn ₹0", zero.join(","));
  ok(kind("2026-11-08").kind === "off" && kind("2026-11-11").kind === "holiday" && kind("2026-11-11").holiday === "Test holiday" && kind("2026-11-11").paise === 0, "Days view: Sunday off; the holiday earns nothing even with calls on it");
  ok(kind("2026-11-01").kind === "off" && kind("2026-11-23").kind === "future", "Days view: days after today are not counted yet");
  ok(kind("2026-11-06").countAsFull === true && kind("2026-11-09").parts.length === 1 && kind("2026-11-09").parts[0].target === 7200, "Days view: count-as-full shown; 9 Nov kept its saved 2 h target and ticks");
  ok(D.base === salaryPaise / 100 && D.days.reduce((t, x) => t + x.paise, 0) === salaryPaise, "Days view: salary = the sum of the days shown, to the paisa (₹4,249.99)", `${D.base}`);
  ok(D.commission === 902 && D.trial.count === 1 && D.regular.count === 104, "commission so far: 1 trial × ₹100 + 10 % of ₹8,019.50 = ₹902", JSON.stringify({ c: D.commission, t: D.trial.count, r: D.regular.count }));
  ok(JSON.stringify(D.extras) === JSON.stringify([{ name: "Bonus", amount: 500 }]) && JSON.stringify(D.deductions) === JSON.stringify([{ name: "Late", amount: 258 }]), "extras and deductions so far: only those started by today; 5 % of salary + commission ₹5,151.99 = ₹258", JSON.stringify({ e: D.extras, d: D.deductions }));
  ok(D.total === total, "earned so far: ₹4,249.99 + ₹902 + ₹500 − ₹258 = ₹5,393.99", `${D.total}`);

  // the same numbers everywhere: Employee Tracker, the Super Admin's eye, the rep's own dashboard, the rep's own days
  const row = (await get(owner, `/employees/payroll?month=2026-11&${AS}`)).data.people.find((x) => x.id === rid);
  const eye = (await get(owner, `/employees/${rid}/summary?date_from=2026-11-21&date_to=2026-11-21&${AS}`)).data;
  const mine = (await get(repTok, `/employees/me/summary?date_from=2026-11-21&date_to=2026-11-21&${AS}`)).data;
  const myDays = (await get(repTok, `/pay/days?month=2026-11&${AS}`)).data;
  const sig = (x) => x && [x.mode, x.base, x.commission, x.total, x.working_days, x.days_so_far].join("|");
  const expect = ["daily", salaryPaise / 100, 902, total, 24, 17].join("|");
  ok(sig(row) === expect, "Employee Tracker row = the hand-worked numbers", sig(row));
  ok(sig(eye?.pay) === expect, "Super Admin's eye (rep's dashboard) = the same numbers", sig(eye?.pay));
  ok(sig(mine?.pay) === expect, "the rep's own dashboard = the same numbers", sig(mine?.pay));
  ok(sig(myDays) === expect && myDays.days.length === 30, "the rep's own Days list = the same numbers", sig(myDays));
  ok(mine?.today?.call_secs === kind("2026-11-21").done.call_secs && mine.today.call_secs === 3600, "today's targets box and today's row agree (1 h)", `${mine?.today?.call_secs}`);
  // the redesigned dashboard: earnings at the top and the targets box come from the same calculation
  ok(mine?.status === "active" && mine.today.final === false && mine.today.targets.call_secs === 3600 && mine.today.targets.tick_call === true, "dashboard: status, today's live targets and ticks", JSON.stringify(mine && { s: mine.status, f: mine.today.final, t: mine.today.targets }));
  ok(mine?.today?.pay?.salary === kind("2026-11-21").paise / 100 && mine.today.pay.num === kind("2026-11-21").num && mine.today.pay.den === kind("2026-11-21").den, "dashboard: today's share and salary = the Days row", JSON.stringify(mine?.today?.pay));
  ok(mine?.earnings?.today?.salary === 333.33 && mine.earnings.today.commission === 0 && mine.earnings.today.fees === 0, "dashboard: Today card = ₹333.33 salary, no fees", JSON.stringify(mine?.earnings?.today));
  ok(mine?.earnings?.yesterday?.date === "2026-11-20" && mine.earnings.yesterday.salary === 333.33 && mine.earnings.yesterday.commission === 102 && mine.earnings.yesterday.fees === 102, "dashboard: Yesterday card = ₹333.33 salary + ₹102 commission on 102 fees", JSON.stringify(mine?.earnings?.yesterday));
  const d9 = (await get(repTok, `/employees/me/summary?date_from=2026-11-09&date_to=2026-11-09&${AS}`)).data?.today;
  ok(d9?.final === true && d9.targets.call_secs === 7200 && d9.targets.tick_trial === false && d9.pay?.salary === 500, "dashboard: a closed day shows its SAVED targets (2 h, only calling) and is final", JSON.stringify(d9 && { f: d9.final, t: d9.targets, p: d9.pay?.salary }));
  ok((await get(repTok, `/pay/days?employee_id=${nehaId}&month=2026-11&${AS}`)).status === 403, "a rep can't open someone else's days");
  ok((await get(repTok, "/pay/settings")).status === 403, "a rep can't open the Working days panel");
  await call(owner, "PATCH", `/employees/${rid}`, { permissions: ["recordings", "working_days"] });
  ok((await get(repTok, "/pay/settings?month=2026-11")).status === 200, "…unless the Working Days tab is ticked for them");
  ok((await get(repTok, `/employees/payroll?month=2026-11&${AS}`)).status === 403, "…which still doesn't open the Employee Tracker");
  await call(owner, "PATCH", `/employees/${rid}`, { permissions: ["recordings"] });

  // joining later, and switching off, take days away
  await call(owner, "PATCH", `/employees/${rid}`, { join_date: "2026-11-04" });
  ok((await get(owner, `/pay/days?employee_id=${rid}&month=2026-11&${AS}`)).data.base === (salaryPaise - 33333 - 50000) / 100, "joining on 4 Nov: 2 and 3 Nov are not paid");
  await call(owner, "PATCH", `/employees/${rid}`, { join_date: "2026-11-02" });
  await pool.query("UPDATE employees SET status = 'inactive', left_on = '2026-11-10' WHERE id = $1", [rid]);
  const left = (await get(owner, `/pay/days?employee_id=${rid}&month=2026-11&${AS}`)).data;
  ok(left.base === (33333 + 50000 + 25000 + 16667 + 100000 + 33333 + 50000 + 50000) / 100 && left.days.find((x) => x.day === "2026-11-12").kind === "away", "switched off on 10 Nov: paid up to and including 10 Nov only", `${left.base}`);
  const leftRow = (await get(owner, `/employees/payroll?month=2026-11&${AS}`)).data.people.find((x) => x.id === rid);
  ok(leftRow?.base === left.base && leftRow.left_on === "2026-11-10", "…and the tracker shows the same for the leaver");
  ok((await get(owner, `/employees/${rid}/summary?date_from=2026-11-21&date_to=2026-11-21&${AS}`)).data?.status === "inactive", "dashboard: a switched-off rep shows Inactive");
  await pool.query("UPDATE employees SET status = 'active', left_on = NULL WHERE id = $1", [rid]);

  // closing days saves the targets: closing up to 22 Nov leaves the money unchanged; a later target change only moves today
  const closed = (await call(owner, "POST", "/pay/dev/close-days", { today: "2026-11-23" })).data;
  ok(closed?.closed > 0, "closing days saves targets for the days that ended", JSON.stringify(closed));
  ok((await get(owner, `/pay/days?employee_id=${rid}&month=2026-11&${AS}`)).data.total === total, "closing days doesn't change what was earned");
  await call(owner, "PATCH", `/employees/${rid}`, { target_call_secs: 7200 });
  const after = (await get(owner, `/pay/days?employee_id=${rid}&month=2026-11&${AS}`)).data;
  const changed = after.days.filter((x) => x.paise !== (D.days.find((y) => y.day === x.day)?.paise)).map((x) => x.day);
  ok(changed.join(",") === "2026-11-21" && after.days.find((x) => x.day === "2026-11-21").paise === 16667, "a target changed later: closed days keep their old target; only today (live) moves", changed.join(","));

  // count as full can be undone
  await call(owner, "PUT", `/pay/overrides?${AS}`, { employee_id: rid, day: "2026-11-06", full: false });
  const undo = await get(owner, `/pay/days?employee_id=${rid}&month=2026-11&${AS}`);
  ok(undo.data?.days?.find((x) => x.day === "2026-11-06")?.paise === 0, "count as full undone: 6 Nov back to ₹0", `${undo.status} ${undo.msg}`);

  // on/off history (client's check, 15 Nov 2026): switched off on the 12th, back on the 16th. The nightly close saves a day
  // only for people working that day, so 13–14 Nov stay unpaid even though the record now just says "active"
  await pool.query("DELETE FROM day_targets WHERE employee_id = $1 AND day >= '2026-11-12'", [rid]);
  await pool.query(`UPDATE pay_settings SET value = '"2026-11-11"'::jsonb WHERE key = 'closed_through'`);
  ok((await call(owner, "PATCH", `/employees/${rid}`, { status: "inactive" })).status === 200, "switched off (on/off history check)");
  await pool.query("UPDATE employees SET left_on = '2026-11-12' WHERE id = $1", [rid]);   // as if switched off on the 12th
  await call(owner, "POST", "/pay/dev/close-days", { today: "2026-11-16" });              // nights of 12–15 Nov pass while off
  ok((await call(owner, "PATCH", `/employees/${rid}`, { status: "active" })).status === 200 &&
     (await pool.query("SELECT status, left_on FROM employees WHERE id = $1", [rid])).rows[0].left_on === null, "back on: the record now only says active");
  await call(owner, "POST", "/pay/dev/close-days", { today: "2026-11-23" });              // nights of 16–22 Nov pass while on
  const hist = (await get(owner, `/pay/days?employee_id=${rid}&month=2026-11&${AS}`)).data;
  const k = (d) => hist.days.find((x) => x.day === d)?.kind;
  ok(k("2026-11-12") === "working" && k("2026-11-13") === "away" && k("2026-11-14") === "away" && k("2026-11-16") === "working" && k("2026-11-20") === "working",
    "on/off history: off 13–14 Nov stay unpaid after switching back on; the 12th (switch-off day) and 16th on count",
    ["12", "13", "14", "16", "20"].map((d) => `${d}:${k(`2026-11-${d}`)}`).join(" "));
  const rowH = (await get(owner, `/employees/payroll?month=2026-11&${AS}`)).data.people.find((x) => x.id === rid);
  ok(rowH?.base === hist.base, "…and the Employee Tracker pays the same days", `${rowH?.base} vs ${hist.base}`);

  // clean up: the rep (with her calls, saved days and overrides), the test holiday, the days closed here, the settings
  await pool.query("DELETE FROM calls WHERE source_file_key LIKE $1", [`e2e/${stamp}/dp-%`]);
  await pool.query("DELETE FROM employees WHERE id = $1", [rid]);
  await pool.query("DELETE FROM holidays WHERE day = '2026-11-11'");
  await pool.query("DELETE FROM day_targets WHERE closed_at >= $1 OR day >= '2026-10-01'", [t0]);
  await pool.query("DELETE FROM pay_settings WHERE key IN ('closed_from', 'closed_through')");
  await call(owner, "PUT", "/pay/settings", { weekdays: settingsBefore.weekdays, daily_pay_from: settingsBefore.daily_pay_from });
}

mock.server.close();

// ── clean up: test users, line 99, intercom links as they were ──
await pool.query("DELETE FROM employees WHERE email LIKE $1 OR email LIKE $2 OR email LIKE $3", [`e2e${stamp}%`, `x${stamp}%`, `y${stamp}%`]);
for (const i of icBefore) await pool.query("UPDATE intercoms SET line_number = NULL WHERE id = $1", [i.id]);
for (const i of icBefore) if (i.line_number) await pool.query("UPDATE intercoms SET line_number = $2 WHERE id = $1", [i.id, i.line_number]);
await pool.query("DELETE FROM lines WHERE line_number = '99'");
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
