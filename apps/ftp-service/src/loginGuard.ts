// Locks out an address that keeps guessing the FTP login (25 Nov 2026: bots guessed the old weak login and a
// server in China logged in). Built so the offices can't be locked out by it:
//  - an address that delivered a real KoreCall recording (a .wav named the PBX's way) in the last 7 days is never blocked, so the KoreCall boxes'
//    own internet addresses are exempt even if a box is set up with a wrong password;
//  - only failed logins count, MAX_FAILS of them within WINDOW_MS (a box with the right password never fails);
//  - a block lasts BLOCK_MS, then the address may try again; restarting the receiver clears every block.
export const MAX_FAILS = 10;
export const WINDOW_MS = 15 * 60_000;
export const BLOCK_MS = 60 * 60_000;
export const TRUST_MS = 7 * 24 * 3600_000;

/** "::ffff:1.2.3.4" and "1.2.3.4" are the same client */
export const plainIp = (ip?: string | null) => (ip ?? "").replace(/^::ffff:/i, "");

export class LoginGuard {
  private fails = new Map<string, number[]>();
  private blockedUntil = new Map<string, number>();
  private trustedAt = new Map<string, number>();

  trusted(ip: string, now = Date.now()) {
    const at = this.trustedAt.get(ip);
    return at !== undefined && now - at < TRUST_MS;
  }

  /** a real recording arrived from this address */
  delivered(ip: string, now = Date.now()) {
    this.trustedAt.set(ip, now);
    this.fails.delete(ip);
    this.blockedUntil.delete(ip);
  }

  isBlocked(ip: string, now = Date.now()) {
    const until = this.blockedUntil.get(ip);
    if (until === undefined) return false;
    if (now < until && !this.trusted(ip, now)) return true;
    this.blockedUntil.delete(ip);
    return false;
  }

  /** a wrong login; true when this one tips the address into a block */
  failed(ip: string, now = Date.now()) {
    if (!ip || this.trusted(ip, now)) return false;
    const recent = (this.fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    if (recent.length < MAX_FAILS) { this.fails.set(ip, recent); return false; }
    this.fails.delete(ip);
    this.blockedUntil.set(ip, now + BLOCK_MS);
    return true;
  }
}
