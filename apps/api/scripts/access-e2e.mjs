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
  regular_commission: 500, regular_commission_type: "fix", other_amount: 1500, target_call_secs: 21600, target_trial: 2, target_regular: 1,
  permissions: ["crm_leads", "recordings"], line_id: freeLine.id, intercom_id: ic608.id,
  extra_commissions: [ex, { ...ex, name: "Old rule", counts: "fee", reward: "pct", days: [], hours: null }], extra_deductions: [dd, { ...dd, name: "Fine", type: "fix", amount: 500 }] };
const created = await call(owner, "POST", "/employees", full);
ok(created.status === 201, "creates a valid user", `${created.status} ${created.msg}`);
const u = created.data;
ok(u?.fix_salary === 12000 && u?.trial_commission === 20 && u?.trial_commission_type === "pct" && u?.other_amount === 1500, "salary fields saved");
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
  // the dashboard's pay is the tracker's number: 12000 + 1500 + 52100 + 200 − 1700
  ok(ps.pay?.month === "2026-11" && ps.pay.total === 64100, "dashboard month pay = tracker payout (extras added, deductions taken off)", JSON.stringify(ps.pay));
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
  ok((await call(owner, "GET", "/payments?from=2025-01-01&to=2026-11-30")).status === 400, "Payments tab: more than a year → 400");
  mock.broken.add(nehaId);
  // another period, so the 2-minute cache doesn't answer from the good read above
  ok((await call(owner, "GET", "/payments?from=2026-11-02&to=2026-11-30")).data?.missing?.some((m) => /unexpected shape/.test(m.error)), "Payments tab: a rep whose payments fail is named, the rest still load");
  await call(owner, "PATCH", `/employees/${u.id}`, { permissions: [...me.permissions, "payments"] });
  const rp = await call(rep, "GET", "/payments?from=2026-11-02&to=2026-11-30");
  ok(rp.status === 200 && rp.data.payments.length === 105 && rp.data.missing.length === 0, "Payments tab: a User asks only for their own", JSON.stringify(rp.data?.missing));
  await call(owner, "PATCH", `/employees/${u.id}`, { permissions: me.permissions });
  mock.broken.delete(nehaId);

  mock.broken.add((await call(owner, "GET", "/auth/me")).data.id);
  const ob = await call(owner, "GET", `/employees/me/summary?${nov}`);
  ok(ob.status === 200 && ob.data.payments.connected === false && /unexpected shape/.test(ob.data.payments.error), "a broken payments answer shows an error, the page still loads", JSON.stringify(ob.data?.payments));
  const pr = await call(owner, "GET", "/employees/payroll?month=2026-11");
  const mine = pr.data?.people?.find((x) => x.id === u.id);
  // 12000 + 1500 + (100 + 52000) + 2 extras × ₹100 − (10 % of 12000 + ₹500)
  ok(pr.status === 200 && mine?.total === 64100, "month payout = base + other + commission + extras − deductions", JSON.stringify(mine));
  ok(mine && !("extra_commissions" in mine) && mine.deductions.length === 2 && mine.extras.length === 2, "payroll row lists the extras and deductions applied");
  ok((await call(owner, "GET", "/employees/payroll?month=2026-13")).status === 400, "payroll: bad month → 400");
  ok((await call(rep, "GET", "/employees/payroll")).status === 403, "payroll: a User is refused");
}

await call(owner, "PATCH", `/employees/${u.id}`, { permissions: ["crm_leads"] });
ok((await call(rep, "GET", "/calls?limit=1")).status === 403, "unticking Recordings applies at once");

// ── ranks ──
await call(owner, "PATCH", `/employees/${u.id}`, { role: "admin", permissions: ["users", "recordings"] });
const adm = (await login(base.email, base.password)).token;
ok((await call(adm, "GET", "/employees/payroll")).status === 403, "payroll: an Admin is refused (Super Admin only)");
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


mock.server.close();

// ── clean up: test users, line 99, intercom links as they were ──
await pool.query("DELETE FROM employees WHERE email LIKE $1 OR email LIKE $2 OR email LIKE $3", [`e2e${stamp}%`, `x${stamp}%`, `y${stamp}%`]);
for (const i of icBefore) await pool.query("UPDATE intercoms SET line_number = NULL WHERE id = $1", [i.id]);
for (const i of icBefore) if (i.line_number) await pool.query("UPDATE intercoms SET line_number = $2 WHERE id = $1", [i.id, i.line_number]);
await pool.query("DELETE FROM lines WHERE line_number = '99'");
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
