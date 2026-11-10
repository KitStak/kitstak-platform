/**
 * Date-only values (`expected_return_date` is stored as "YYYY-MM-DD"). PURE, unit tested in a
 * negative-UTC-offset timezone. `new Date("2026-11-20")` is UTC midnight, which renders as
 * Nov 19 anywhere west of UTC, so date-only strings are always read as LOCAL calendar dates
 * and written back from the local calendar fields — never through `toISOString()`.
 */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-20" (or "2026-11-20T…") → local midnight on Nov 20; anything else → null. */
export function localDateFromIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = DATE_ONLY_RE.exec(value.slice(0, 10));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d;
}

/** Local calendar date → "YYYY-MM-DD" (no timezone shift). */
export function isoFromLocalDate(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True for a real "YYYY-MM-DD" calendar date (rejects 2026-02-30). */
export function isDateOnly(value: string): boolean {
  return localDateFromIso(value) !== null && DATE_ONLY_RE.test(value);
}
