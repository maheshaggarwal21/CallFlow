/**
 * CRM prototype demo data — LOCAL DATABASES ONLY.
 *
 *   npm run crm:seed          wipe the demo rows, then seed fresh ones relative to now
 *   npm run crm:reset-demo    same (kept as a separate name for the demo script)
 *
 * Every row it creates is marked, and the wipe deletes by those markers only:
 *   staff emails  *@crm-demo.local     lines   purpose = 'crm-demo'
 *   leads         source = 'demo'      calls   source_file_key LIKE 'crmdemo/%'
 * Names are invented and every number is a fake 90000 1xxxx.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import pool from "./db/pool";
import { assertLocalDb } from "./lib/crm/localDb";
import { istMidnight, istParts } from "./lib/dateRange";
import { DEV_UPLOADS_DIR } from "./services/storage.service";

assertLocalDb(process.env.DATABASE_URL, "seedCrm");

const PASSWORD = "Demo@1234";
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const now = new Date();

// Deterministic randomness so every demo looks the same (relative to "now")
let seedState = 20261106;
const rnd = () => (seedState = (seedState * 16807) % 2147483647) / 2147483647;
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

// ── Audio (tones only, no voices) ──────────────────────────────────────────
const AUDIO: Record<string, string[]> = {
  "crmdemo-ring.webm": ["-f", "lavfi", "-i", "sine=f=425:d=24", "-af", "volume='if(lt(mod(t,3),1),0.4,0)':eval=frame"],
  "crmdemo-busy.webm": ["-f", "lavfi", "-i", "sine=f=480:d=14", "-af", "volume='if(lt(mod(t,0.75),0.375),0.4,0)':eval=frame"],
  "crmdemo-talk.webm": ["-f", "lavfi", "-i", "sine=f=220:d=95", "-f", "lavfi", "-i", "sine=f=330:d=95", "-filter_complex", "[0][1]amix=inputs=2,volume='0.25+0.15*sin(t*1.7)':eval=frame"],
  "crmdemo-short.mp3": ["-f", "lavfi", "-i", "sine=f=600:d=9", "-af", "volume=0.3"],
};
function makeAudio() {
  mkdirSync(DEV_UPLOADS_DIR, { recursive: true });
  for (const [file, args] of Object.entries(AUDIO)) {
    const out = path.join(DEV_UPLOADS_DIR, file);
    if (existsSync(out)) continue;
    const codec = file.endsWith(".mp3") ? ["-c:a", "libmp3lame", "-b:a", "32k"] : ["-c:a", "libopus", "-b:a", "16k"];
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, "-ac", "1", ...codec, out]);
  }
}

// ── Wipe by markers only ───────────────────────────────────────────────────
async function wipe() {
  await pool.query(`DELETE FROM crm_match_errors WHERE call_id IN (SELECT id FROM calls WHERE source_file_key LIKE 'crmdemo/%')`);
  const calls = await pool.query(`DELETE FROM calls WHERE source_file_key LIKE 'crmdemo/%'`);
  const leads = await pool.query(`DELETE FROM leads WHERE source = 'demo'`);                              // cascades interactions
  await pool.query(`DELETE FROM lines WHERE purpose = 'crm-demo'`);
  const staff = await pool.query(`DELETE FROM employees WHERE email LIKE '%@crm-demo.local'`);           // cascades permissions
  console.log(`wiped demo rows: ${calls.rowCount} calls, ${leads.rowCount} leads, ${staff.rowCount} staff`);
}

// ── People ─────────────────────────────────────────────────────────────────
const REPS = ["Neha Sharma", "Priya Nair", "Ritika Gill", "Anjali Verma", "Sneha Iyer", "Pooja Kapoor", "Simran Joshi"];
type Staff = { id: string; name: string; line: string };

async function people() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const email = (n: string) => `${n.split(" ")[0].toLowerCase()}@crm-demo.local`;
  const { rows: [owner] } = await pool.query(
    `INSERT INTO employees (name, email, phone, role, password_hash, color_index) VALUES ($1, $2, '9000000100', 'owner', $3, 0) RETURNING id`,
    ["Kavita Malhotra", "owner@crm-demo.local", hash]
  );
  const reps: Staff[] = [];
  for (const [i, name] of REPS.entries()) {
    const { rows: [e] } = await pool.query(
      `INSERT INTO employees (name, email, phone, role, password_hash, color_index) VALUES ($1, $2, $3, 'employee', $4, $5) RETURNING id`,
      [name, email(name), `90000001${String(i + 10)}`, hash, (i + 1) % 8]
    );
    const line = String(21 + i);
    await pool.query(
      `INSERT INTO lines (line_number, employee_id, purpose, assigned_at) VALUES ($1, $2, 'crm-demo', NOW())
       ON CONFLICT (line_number) DO UPDATE SET employee_id = EXCLUDED.employee_id, purpose = 'crm-demo'`,
      [line, e.id]
    );
    reps.push({ id: e.id, name, line });
  }
  await pool.query(`INSERT INTO employee_permissions (employee_id, permission) VALUES ($1, 'export_leads')`, [reps[0].id]);
  return { owner: owner.id as string, reps };
}

// ── Lead stories ───────────────────────────────────────────────────────────
type Step = {
  rep: number; at: Date; code: string; reason?: string; note?: string;
  dur?: number;          // seconds of the matched recording; omitted = no recording
  check?: string;        // what the recording sounds like ("busy" picks the busy-tone sample)
  link?: boolean;        // false = recording exists but no form linked to it (mismatch)
  form?: boolean;        // false = recording only
  followup?: Date;
  expired?: boolean;     // > 90 days old, audio deleted by retention
  phoneOverride?: string;// typo: the recording is on a slightly different number
};
type Story = {
  name: string; campaign: string; created: Date; status: string; code?: string; followup?: Date;
  setBy?: number; attempts?: number; amount?: number; tags?: string[];
  steps: Step[]; reenquiry?: Date;
};

const FIRST = ["Aarav", "Vivaan", "Aditya", "Arjun", "Reyansh", "Ayaan", "Krishna", "Ishaan", "Shaurya", "Atharv",
  "Ananya", "Diya", "Saanvi", "Aadhya", "Kiara", "Myra", "Anika", "Navya", "Ira", "Pari", "Kabir", "Rohan", "Dev",
  "Yash", "Tanvi", "Riya", "Meera", "Nisha", "Karan", "Varun", "Aditi", "Sakshi", "Harsh", "Manav", "Zoya"];
const LAST = ["Mehta", "Sharma", "Patel", "Reddy", "Iyer", "Menon", "Bhatia", "Chopra", "Dutta", "Ghosh", "Kulkarni",
  "Pillai", "Rao", "Saxena", "Tiwari", "Arora", "Bajaj", "Chauhan", "Desai", "Mishra"];
const CAMPAIGNS = ["Meta · Guitar Trial ₹299", "Meta · Kids Guitar", "Meta · Evening Batch", "Instagram · Reel Ad"];

const ago = (ms: number) => new Date(now.getTime() - ms);
const ahead = (ms: number) => new Date(now.getTime() + ms);
// "Today" activity stays in working hours when the demo runs mid-day; early in the day it uses the last few hours
const p = istParts(now);
const dayStart = istMidnight(p.year, p.month, p.day).getTime() + 9 * HOUR;
const todayFrom = Math.min(Math.max(dayStart, now.getTime() - 10 * HOUR), now.getTime() - 3 * HOUR);
const today = (minBefore = 15) => new Date(todayFrom + rnd() * (now.getTime() - minBefore * MIN - todayFrom));
const daysAgo = (d: number) => ago(d * DAY - between(0, 8) * HOUR);

const REASONS = {
  A: ["Switched off", "Not reachable"], B: ["Rang, no answer", "Busy / on another call"], C: ["Cut the call", "Cut after hearing price"],
  D: ["Busy right now", "Asked to call in the evening", "Will discuss with parents"],
  E: ["Will pay after salary", "Buying a guitar first", "Will discuss with parents"],
  F: ["Paid on call (UPI)", "Paid via payment link"],
  // Weighted so "Too expensive" leads the Z breakdown
  G: ["Too expensive", "Too expensive", "Too expensive", "Not interested any more", "Joined somewhere else", "Wants offline classes", "Did not enquire / wrong number", "Too expensive"],
} as const;
const NOTES: Record<string, string[]> = {
  D: ["Asked to call back in the evening, mother decides.", "Driving right now, said call back later today.", "Interested but busy at work, call after 6."],
  E: ["Interested in the trial, will pay after salary on 10th.", "Wants to buy a guitar first, then start the trial.", "Liked the offer, checking timings with school."],
  F: ["Paid ₹299 trial on UPI during the call. Schedule first class.", "Paid ₹299 trial through the payment link. Send class link."],
  G: ["Not interested, asked us not to call again.", "Said the fee is too high for now, do not call."],
};
const failDur = (code: string) => (code === "C" ? between(6, 14) : between(18, 32));
const failCheck = (code: string, reason?: string) =>
  code === "A" ? (reason === "Invalid number" ? "invalid_number" : "switched_off") : code === "B" ? (reason?.startsWith("Busy") ? "busy" : "no_answer") : "possible_conversation";

function failSteps(n: number, start: number, end: number): Step[] {
  return Array.from({ length: n }, (_, i) => {
    const code = pick(["A", "B", "B", "C"] as const);
    const reason = pick(REASONS[code]);
    return { rep: between(0, 6), at: ago(start - ((start - end) * i) / Math.max(1, n - 1)), code, reason, dur: failDur(code), check: failCheck(code, reason) };
  }).sort((a, b) => a.at.getTime() - b.at.getTime());
}
const talk = (rep: number, at: Date, code: "D" | "E" | "F" | "G", followup?: Date): Step => ({
  rep, at, code, reason: pick(REASONS[code]), note: pick(NOTES[code]), dur: between(60, 360), check: "possible_conversation", followup,
});

function stories(): Story[] {
  const S: Story[] = [];
  const person = () => `${pick(FIRST)} ${pick(LAST)}`;
  const camp = () => pick(CAMPAIGNS);

  // 1. Callback due in ~10 min, set by Neha; earlier calls by Priya and Neha (the demo opener)
  const dueAt = ahead(10 * MIN);
  S.push({
    name: "Arjun Mehta", campaign: CAMPAIGNS[0], created: daysAgo(3), status: "callback", code: "D", followup: dueAt, setBy: 0,
    steps: [
      { rep: 1, at: daysAgo(2), code: "B", reason: "Rang, no answer", dur: 26, check: "no_answer" },
      { rep: 0, at: ago(5 * HOUR), code: "D", reason: "Asked to call in the evening", note: "Spoke to Arjun, keen on guitar. Student asked for this evening, call back then.", dur: 214, check: "possible_conversation", followup: dueAt },
    ],
  });
  // 2. Two callbacks later today
  for (const [h, rep] of [[2, 4], [4, 3]] as const) {
    const at = ahead(h * HOUR);
    S.push({ name: person(), campaign: camp(), created: daysAgo(2), status: "callback", code: "E", followup: at, setBy: rep,
      steps: [...failSteps(1, 2 * DAY, 2 * DAY), talk(rep, ago(between(3, 6) * HOUR), "E", at)] });
  }
  // 3. Three overdue callbacks
  for (const [ms, rep] of [[3 * HOUR, 5], [DAY + 2 * HOUR, 6], [2 * DAY + 5 * HOUR, 2]] as const) {
    const at = ago(ms);
    S.push({ name: person(), campaign: camp(), created: ago(ms + 2 * DAY), status: "callback", code: "D", followup: at, setBy: rep,
      steps: [talk(rep, ago(ms + DAY), "D", at)] });
  }
  // 4. Fresh leads from the last hour, and older never-called ones
  for (let i = 0; i < 8; i++) S.push({ name: person(), campaign: camp(), created: ago(between(4, 58) * MIN), status: "new", steps: [] });
  for (let i = 0; i < 30; i++) S.push({ name: person(), campaign: camp(), created: ago(between(2, 160) * HOUR), status: "new", steps: [] });
  // 5. Retries: due (wait passed) and still waiting
  for (let i = 0; i < 38; i++) {
    const n = between(1, 5);
    const steps = failSteps(n, between(2, 6) * DAY, between(1, 8) * HOUR);
    const last = steps[steps.length - 1];
    const wait = last.code === "B" ? 3 * HOUR : last.code === "A" ? 6 * HOUR : 18 * HOUR;
    S.push({ name: person(), campaign: camp(), created: ago(between(6, 7) * DAY), status: "retry", code: last.code,
      followup: new Date(last.at.getTime() + wait), attempts: n, steps });
  }
  // 6. Callbacks later this week
  for (let i = 0; i < 12; i++) {
    const at = ahead(between(1, 5) * DAY + between(0, 6) * HOUR);
    const rep = between(0, 6);
    S.push({ name: person(), campaign: camp(), created: daysAgo(between(2, 6)), status: "callback", code: pick(["D", "E"]), followup: at, setBy: rep,
      steps: [...failSteps(between(1, 3), 5 * DAY, 2 * DAY), talk(rep, daysAgo(1), pick(["D", "E"] as const), at)] });
  }
  // 7. Converted, several of them today
  for (let i = 0; i < 18; i++) {
    const rep = i % 7, at = i < 6 ? today() : daysAgo(between(1, 6));
    S.push({ name: person(), campaign: camp(), created: new Date(at.getTime() - between(1, 3) * DAY), status: "converted", code: "F", amount: 299,
      steps: [...failSteps(between(1, 3), 9 * DAY, 7 * DAY), { ...talk(rep, at, "F") }] });
  }
  // 8. Not interested (Z)
  for (let i = 0; i < 22; i++) {
    const rep = between(0, 6), at = i < 7 ? today() : daysAgo(between(1, 6));
    S.push({ name: person(), campaign: camp(), created: new Date(at.getTime() - 3 * DAY), status: "dnc", code: "G",
      steps: [...failSteps(between(0, 3), 3 * DAY, 2 * DAY), talk(rep, at, "G")] });
  }
  // 9. Dropped after 6 failed attempts, plus one invalid number
  for (let i = 0; i < 5; i++) {
    const steps = failSteps(6, 6.5 * DAY, 4 * HOUR);
    S.push({ name: person(), campaign: camp(), created: ago(7 * DAY), status: "dropped", code: steps[5].code, attempts: 6, steps });
  }
  S.push({ name: person(), campaign: camp(), created: daysAgo(4), status: "dropped", code: "A", attempts: 1,
    steps: [{ rep: 3, at: daysAgo(3), code: "A", reason: "Invalid number", dur: 9, check: "invalid_number" }] });
  // 10. Re-enquired: Z four months ago (audio long expired), new ad lead today
  S.push({ name: "Rohan Kulkarni", campaign: CAMPAIGNS[2], created: ago(30 * MIN), status: "new", code: "G", tags: ["re-enquired"], reenquiry: ago(30 * MIN),
    steps: [
      { rep: 2, at: ago(124 * DAY), code: "B", reason: "Rang, no answer", dur: 24, check: "no_answer", expired: true },
      { rep: 5, at: ago(123 * DAY), code: "G", reason: "Too expensive", note: "Said the fee is too high for now, do not call.", dur: 140, check: "possible_conversation", expired: true },
    ] });
  // 11. Deliberate mismatches, all today
  for (let i = 0; i < 3; i++) // forms without a recording
    S.push({ name: person(), campaign: camp(), created: daysAgo(2), status: "retry", code: "B", followup: ahead(2 * HOUR), attempts: 1,
      steps: [{ rep: 3 + i, at: today(40), code: "B", reason: "Rang, no answer" }] });
  for (let i = 0; i < 3; i++) // lead recordings without a form
    S.push({ name: person(), campaign: camp(), created: daysAgo(1), status: "new",
      steps: [{ rep: i, at: today(20), code: "B", dur: between(20, 90), check: i === 2 ? "possible_conversation" : "no_answer", form: false }] });
  for (const swap of [true, false]) // probable typos: the recording is on a number one slip away
    S.push({ name: person(), campaign: camp(), created: daysAgo(1), status: "callback", code: "D", followup: ahead(DAY), setBy: 6,
      steps: [{ ...talk(6, today(60), "D", ahead(DAY)), phoneOverride: swap ? "swap" : "digit" }] });
  // 12. D saved on a call the auto-check heard as busy
  S.push({ name: person(), campaign: camp(), created: daysAgo(1), status: "callback", code: "D", followup: ahead(5 * HOUR), setBy: 4,
    steps: [{ rep: 4, at: today(30), code: "D", reason: "Busy right now", note: "Said call back later, sounded busy on the line.", dur: 17, check: "busy", followup: ahead(5 * HOUR) }] });
  // 13. One paid today with no recording matched (flagged in the F digest)
  S.push({ name: "Ira Desai", campaign: CAMPAIGNS[1], created: daysAgo(2), status: "converted", code: "F", amount: 299,
    steps: [{ rep: 1, at: today(25), code: "F", reason: "Paid via payment link", note: "Paid ₹299 trial through the payment link. Send class link." }] });
  return S;
}

function typoOf(p: string, kind: string) {
  if (kind === "swap") { const a = p.split(""); [a[7], a[8]] = [a[8], a[7]]; if (a.join("") !== p) return a.join(""); }
  return p.slice(0, 9) + String((Number(p[9]) + 3) % 10);
}

async function main() {
  makeAudio();
  await wipe();
  if (process.argv.includes("--wipe-only")) return;
  const { reps } = await people();

  const used = new Set<string>();
  const phone = () => { let x: string; do x = `900001${String(between(0, 9999)).padStart(4, "0")}`; while (used.has(x) || x[8] === x[9]); used.add(x); return x; };
  let leads = 0, calls = 0, forms = 0;

  for (const s of stories()) {
    const p10 = phone();
    const { rows: [lead] } = await pool.query(
      `INSERT INTO leads (name, email, phone_raw, phone10, source, campaign, external_id, status, current_code, next_followup_at,
                          callback_set_by, attempts, last_contacted_at, amount, tags, created_at, updated_at, raw, assigned_to)
       VALUES ($1, $2, $3, $4, 'demo', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), $16, $10) RETURNING id`,
      [s.name, `${s.name.split(" ")[0].toLowerCase()}@example.com`, `+91 ${p10.slice(0, 5)} ${p10.slice(5)}`, p10, s.campaign,
       `demo-${p10}`, s.status, s.code ?? null, s.followup ?? null, s.setBy !== undefined ? reps[s.setBy].id : null,
       s.attempts ?? 0, s.steps.length ? s.steps[s.steps.length - 1].at : null, s.amount ?? null, s.tags ?? [], s.created,
       JSON.stringify({ demo: true })]
    );
    leads++;

    for (const [stepNo, st] of s.steps.entries()) {
      const rep = reps[st.rep];
      let callId: string | null = null;
      if (st.dur !== undefined) {
        const callPhone = st.phoneOverride ? typoOf(p10, st.phoneOverride) : p10;
        const calledAt = new Date(st.at.getTime() - (st.dur + 60) * 1000);
        const audio = st.expired ? null : st.dur >= 45 ? "crmdemo/crmdemo-talk.webm" : st.check === "busy" ? "crmdemo/crmdemo-busy.webm"
          : st.dur < 10 ? "crmdemo/crmdemo-short.mp3" : "crmdemo/crmdemo-ring.webm";
        const { rows: [c] } = await pool.query(
          `INSERT INTO calls (source, source_file_key, line_number, call_direction, caller_phone, called_at, duration_secs,
                              employee_id, is_misc, audio_storage_key, keep_audio)
           VALUES ('korecall', $1, $2, 'outbound', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [`crmdemo/${lead.id}/${stepNo}.wav`, rep.line, `0${callPhone}`, calledAt, st.dur, rep.id, st.dur < 10, audio,
           st.form !== false && st.link !== false && (st.code === "F" || st.code === "G")]
        );
        callId = c.id;
        calls++;
      }
      if (st.form === false) continue;
      const linkCall = callId && st.link !== false && !st.phoneOverride ? callId : null;
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, employee_id, kind, code, reason, note, next_followup_at, call_id, created_at)
         VALUES ($1, $2, 'call_outcome', $3, $4, $5, $6, $7, $8)`,
        [lead.id, rep.id, st.code, st.reason ?? null, st.note ?? null, st.followup ?? null, linkCall, st.at]
      );
      forms++;
    }
    if (s.reenquiry) {
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, kind, note, meta, created_at) VALUES ($1, 'reenquiry', $2, $3, $4)`,
        [lead.id, `Re-enquired via Meta · ${s.campaign}`, JSON.stringify({ external_id: `demo-re-${p10}`, source: "demo" }), s.reenquiry]
      );
    }
  }
  // Guitar Yes/No for every lead a rep has spoken to
  await pool.query("UPDATE leads SET has_guitar = random() < 0.6 WHERE source = $1 AND status <> $2", ["demo", "new"]);
  console.log(`seeded ${leads} leads, ${forms} history entries, ${calls} recordings · staff password: ${PASSWORD}`);
  console.log(`logins: owner@crm-demo.local, ${REPS.map((n) => `${n.split(" ")[0].toLowerCase()}@crm-demo.local`).join(", ")}`);
}

main()
  .catch((e) => { console.error("seedCrm failed:", e.message); process.exitCode = 1; })
  .finally(() => pool.end());
