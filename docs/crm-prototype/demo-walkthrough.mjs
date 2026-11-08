// Plays the CRM demo flow against the LOCAL app and saves a screenshot per step. Also an end-to-end check:
// it exits non-zero if a step fails.
//   PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node docs/crm-prototype/demo-walkthrough.mjs
// Needs: local API on :4000 (npm run crm:dev), web on :3000, fresh seed (npm run crm:reset-demo).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import { mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const WEB = process.env.WEB ?? "http://localhost:3000";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "screenshots");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`• ${m}`);
const IST_TOMORROW = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const browser = await chromium.launch();
async function login(who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.error(`  [${who}] page error:`, String(e)); process.exitCode = 1; });
  await page.goto(`${WEB}/login`);
  await page.fill('input[type="email"]', `${who}@crm-demo.local`);
  await page.fill('input[type="password"]', "Demo@1234");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/);
  await page.goto(`${WEB}/dashboard/crm`);
  await page.waitForSelector("text=Follow-ups today");
  await page.waitForTimeout(1200);
  return page;
}
const shot = async (page, name, opts = {}) => { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, name), ...opts }); log(name); };
const form = (page) => page.getByRole("dialog", { name: "Lead" });

// 1. Leads page: tiles, filters, the due-now banner and the blinking row on top
const neha = await login("neha");
await shot(neha, "01-leads-page.png");

// 2. Open the due lead from the Actions column: WhatsApp top right, Basic details (contact + copy), Call & follow-up
await neha.locator('button[title="Open lead form"]').first().click();
await form(neha).waitFor();
await shot(neha, "02-lead-form.png");

// 3. Status dropdown with the coloured code chips
await form(neha).getByRole("button", { name: "Status" }).click();
await shot(neha, "03-status-dropdown.png");
await form(neha).getByRole("option", { name: /Call later/ }).click();

// 4. A second rep opening the same lead sees it locked
const priya = await login("priya");
await priya.locator('button[title="Open lead form"]').first().click();
await form(priya).getByText(/is on this lead/).waitFor();
await shot(priya, "04-second-rep-sees-lock.png");
await priya.keyboard.press("Escape");

// 5. Fill the follow-up: the reminder banner previews it; the History handle opens snapshot + call log
const f = form(neha);
await f.getByLabel("Guitar").selectOption("Yes");
await f.getByLabel("Next follow-up date").fill(IST_TOMORROW);
await f.getByLabel("Next follow-up time").fill("17:30");
await f.locator("textarea").fill("Student asked to call after 5:30 PM tomorrow about the trial.");
await f.getByRole("button", { name: /History ·/ }).click();
await shot(neha, "05-form-filled-history-open.png");

// 6. Save: the lead leaves "Follow-up due now"
await f.getByRole("button", { name: /^Save$/ }).click();
await neha.getByText(/saved as D · Call later/).waitFor();
await shot(neha, "06-saved.png");

// 7. Owner: CRM Settings (statuses A–O + who can export)
const owner = await login("owner");
await owner.goto(`${WEB}/dashboard/crm/settings`);
await owner.waitForSelector("text=Statuses");
await shot(owner, "07-crm-settings.png", { fullPage: true });

await browser.close();
log(process.exitCode ? "walkthrough finished WITH ERRORS" : "walkthrough OK");
