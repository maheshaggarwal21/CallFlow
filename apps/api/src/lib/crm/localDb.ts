// The CRM prototype must never touch production. Every dev script checks the
// database host before doing anything.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Host of a postgres:// URL, or null when it can't be parsed. */
export function dbHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** Prints the target host and exits the process unless it is local. */
export function assertLocalDb(url = process.env.DATABASE_URL, what = "this script"): void {
  const host = dbHost(url);
  console.log(`[crm-safety] ${what} → database host: ${host ?? "(unparseable)"}`);
  if (!host || !LOCAL_HOSTS.has(host)) {
    console.error(`[crm-safety] REFUSING: ${what} may only run against localhost / 127.0.0.1.`);
    process.exit(1);
  }
}
