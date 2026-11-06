// Plays the CRM demo flow against the LOCAL app and saves a screenshot per step.
//   PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node docs/crm-prototype/demo-walkthrough.mjs
// Needs: local API on :4000 (npm run crm:dev), web on :3000, fresh seed (npm run crm:reset-demo).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const WEB = process.env.WEB ?? "http://localhost:3000";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "screenshots");
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`• ${m}`);

const browser = await chromium.launch();
async function login(who, height = 900) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error(`  [${who}] page error:`, String(e)));
  await page.goto(`${WEB}/login`);
  await page.fill('input[type="email"]', `${who}@crm-demo.local`);
  await page.fill('input[type="password"]', "Demo@1234");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/);
  return page;
}
const shot = async (page, name, opts = {}) => { await page.waitForTimeout(600); await page.screenshot({ path: join(OUT, name), ...opts }); log(name); };
const drawer = (page) => page.getByRole("dialog", { name: "Lead" });

// 1. Rep logs in: blinking Due now callback set by another rep
const ritika = await login("ritika");
await ritika.goto(`${WEB}/dashboard/crm`);
await ritika.locator("tr.crm-due").first().waitFor();
await shot(ritika, "01-queue-due-now.png");

// 2. Open it: history by two other reps with audio; a second rep sees the lock
await ritika.locator("tr.crm-due").first().click();
await drawer(ritika).getByText("History").first().waitFor();
await ritika.waitForTimeout(1500);
await shot(ritika, "02-drawer-history.png");

const anjali = await login("anjali");
await anjali.goto(`${WEB}/dashboard/crm`);
await anjali.locator("tr.crm-due").first().click();
await drawer(anjali).getByText("is on this lead").waitFor();
await shot(anjali, "03-second-rep-sees-lock.png");
await anjali.keyboard.press("Escape");

// 3. Pick D: reasons and note chips switch; the chip fills the callback time; save
const d = drawer(ritika);
await d.getByRole("radio", { name: /Talked, call me later/ }).click();
await d.locator('label:has-text("Reason") select').selectOption({ label: "Asked to call in the evening" });
await d.locator('label:has-text("Callback time") input').fill("19:30");
await d.locator('label:has-text("Student asked") input').check();
await d.getByRole("button", { name: "+ Call back at time" }).click();
await d.getByRole("radio", { name: /Talked, call me later/ }).scrollIntoViewIfNeeded();
await shot(ritika, "04-code-d-reasons-and-chips.png");
await d.getByRole("button", { name: "Save", exact: true }).click();
await ritika.getByRole("status").filter({ hasText: "saved as D" }).waitFor();
await shot(ritika, "05-saved-left-due-now.png");

// 4. Simulate a new lead: it shows at the top of New
await ritika.getByRole("button", { name: /Simulate new lead/ }).click();
const toast = await ritika.getByRole("status").filter({ hasText: "New lead" }).textContent();
const code = /LMS-\d+/.exec(toast ?? "")?.[0];
await ritika.getByRole("button", { name: "Refresh" }).click();
const newSection = ritika.locator("section", { has: ritika.getByRole("heading", { name: "New", exact: true }) });
await newSection.getByText(code).waitFor();
await newSection.scrollIntoViewIfNeeded();
await shot(ritika, "06-new-lead-arrived.png");

// 5. Open it, send a WhatsApp template (mock), mark F
await newSection.locator("tbody tr").filter({ hasText: code }).click();
const n = drawer(ritika);
await n.getByLabel("WhatsApp template").selectOption({ label: "Trial details" });
await n.getByRole("button", { name: "Send", exact: true }).click();
await n.getByText(/Sent "Trial details"/).waitFor();
await n.getByRole("radio", { name: /Paid ₹299 trial/ }).click();
await n.locator('label:has-text("Reason") select').selectOption({ label: "Paid on call (UPI)" });
await n.getByRole("button", { name: "+ Paid UPI" }).click();
await n.getByRole("button", { name: "Save", exact: true }).click();
await ritika.getByRole("status").filter({ hasText: "saved as F" }).waitFor();
await ritika.getByRole("button", { name: "All leads" }).click();
await ritika.getByLabel("Search leads").fill(code);
await ritika.locator("tbody tr").filter({ hasText: code }).first().click();
await drawer(ritika).getByText("WhatsApp: Trial details").waitFor();
await drawer(ritika).getByText("Paid ₹299 trial").last().waitFor();
await drawer(ritika).getByText("Converted").first().waitFor();
await shot(ritika, "07-f-and-whatsapp-in-history.png");

// 6. Owner: CRM Reports
const owner = await login("owner", 2700);
await owner.goto(`${WEB}/dashboard/crm/reports`);
await owner.getByText("F digest preview").waitFor();
await owner.waitForTimeout(2500);
await shot(owner, "08-crm-reports.png");

// 7. Settings: edit a note template, toggle a permission, pending client decisions
await owner.setViewportSize({ width: 1366, height: 900 });
await owner.goto(`${WEB}/dashboard/crm/settings`);
const templates = owner.locator("section", { has: owner.getByRole("heading", { name: "Note templates" }) });
await templates.getByRole("button", { name: "Edit" }).first().click();
await templates.locator("textarea").fill("Asked to call back on {date} at {time}. Mother decides about classes.");
await templates.scrollIntoViewIfNeeded();
await shot(owner, "09-settings-edit-template.png");
await templates.getByRole("button", { name: "Save", exact: true }).click();
await templates.getByText("Mother decides").waitFor();

const team = owner.locator("section", { has: owner.getByRole("heading", { name: "Team permissions" }) });
const box = team.getByLabel("Ritika Gill: Export leads");
// Controlled checkbox: it flips once the API has saved, so wait for that
const toggled = async (want) => { await box.click(); await owner.waitForFunction((w) =>
  document.querySelector('input[aria-label="Ritika Gill: Export leads"]')?.checked === w, want); };
await toggled(true);
await team.screenshot({ path: join(OUT, "10-team-permissions.png") }); log("10-team-permissions.png");

const retry = owner.locator("section", { has: owner.getByRole("heading", { name: /Retry rules/ }) });
await retry.scrollIntoViewIfNeeded();
await shot(owner, "11-pending-client-decisions.png");

// Leave the demo as it was
await toggled(false);
await templates.getByRole("button", { name: "Edit" }).first().click();
await templates.locator("textarea").fill("Asked to call back on {date} at {time}.");
await templates.getByRole("button", { name: "Save", exact: true }).click();
await templates.getByText("Mother decides").waitFor({ state: "detached" });
await browser.close();
log(`done → ${OUT}`);
