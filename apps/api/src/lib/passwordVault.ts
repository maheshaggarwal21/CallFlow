/**
 * The reversible copy of a user's password, for the Super Admin's "Show saved password" button (client, 15 Nov 2026).
 * AES-256-GCM with a random IV per password; the key is PASSWORD_VIEW_KEY (64 hex characters) in the server's
 * environment only. Without the key nothing is stored and nothing can be shown; login is not affected either way
 * (it uses the bcrypt hash). Format: "v1:" + base64(iv | auth tag | ciphertext).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const key = (): Buffer | null => {
  const k = process.env.PASSWORD_VIEW_KEY ?? "";
  return /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, "hex") : null;
};

export const vaultConfigured = () => key() !== null;

/** Encrypted copy, or null when the key isn't set up (so a stale copy can never outlive a password change). */
export function seal(plain: string): string | null {
  const k = key();
  if (!k) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

/** The password, or null when there is no copy, the key is missing or wrong, or the copy was altered. */
export function open(sealed: string): string | null {
  const k = key();
  if (!k || !sealed.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), "base64");
    const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
