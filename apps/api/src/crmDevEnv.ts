/**
 * Preload for every CRM prototype script: `node -r ./dist/crmDevEnv.js …`.
 *
 * apps/api/.env may point at production (Supabase, R2, Resend). This runs before
 * any other module calls dotenv.config(): it loads .env.crm-dev with override,
 * then sets every outward-facing credential to "" — dotenv never overwrites a
 * key that already exists, so the real .env can't fill them back in. Empty R2
 * vars make storage fall back to dev-uploads/; an empty Resend key makes mail
 * print to the console.
 */
import path from "path";
import dotenv from "dotenv";
import { assertLocalDb } from "./lib/crm/localDb";

dotenv.config({ path: path.join(__dirname, "..", ".env.crm-dev"), override: true });

for (const k of [
  "R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
  "RESEND_API_KEY", "REPORT_MAIL_FROM", "WATI_API_URL", "WATI_TOKEN",
  "DEEPGRAM_API_KEY", "OPENAI_API_KEY", "REDIS_URL",
]) process.env[k] = "";
process.env.NODE_ENV = "development";

assertLocalDb(process.env.DATABASE_URL, path.basename(process.argv[1] ?? "script"));
