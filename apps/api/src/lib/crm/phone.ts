/**
 * Last 10 digits of the digits-only number, or null. Must match the generated
 * column calls.phone10 in 011_crm_2_calls.sql:
 *   NULLIF(right(regexp_replace(coalesce(caller_phone,''), '\D', '', 'g'), 10), '')
 */
export function phone10(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.slice(-10) || null;
}

export const isFullPhone10 = (p: string | null): p is string => !!p && /^\d{10}$/.test(p);

/** "9465658112" → "94656 58112", the way reps read a number out while dialling. */
export const groupPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p);

/**
 * Two 10-digit numbers that differ by exactly one digit, or by one swap of two
 * neighbouring digits: the typical slip when a rep types a number into the form.
 */
export function isProbableTypo(a: string, b: string): boolean {
  if (a.length !== 10 || b.length !== 10 || a === b) return false;
  const diff: number[] = [];
  for (let i = 0; i < 10 && diff.length <= 2; i++) if (a[i] !== b[i]) diff.push(i);
  if (diff.length === 1) return true;
  const [i, j] = diff;
  return diff.length === 2 && j === i + 1 && a[i] === b[j] && a[j] === b[i];
}
