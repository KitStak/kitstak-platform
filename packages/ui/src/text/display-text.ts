/**
 * Display formatting shared by every KitStak app. The brand rule is no em dashes or double
 * dashes in UI copy, but record names arrive from seeds, imports and sales channels with them
 * ("Bluebird Dad Cap — Khaki"). Render through `displayText` so the same record reads the same
 * in Projects, CRM and WMS ("Bluebird Dad Cap · Khaki").
 */

/** Shown for a field with no value (instead of a lone dash). */
export const EMPTY_VALUE = 'None';

const SPACED_DASH = /\s+(?:[—–]|-{2,})\s+/g;
const BARE_LONG_DASH = /\s*—\s*/g;

/**
 * Replaces spaced em/en dashes and double hyphens used as separators with " · ", and any other
 * em dash with " · ". A lone dash placeholder becomes `empty`. En dashes inside ranges
 * ("1–10") are left alone. Null or blank input returns `empty`.
 */
export function displayText(value: string | null | undefined, empty: string = EMPTY_VALUE): string {
  if (value === null || value === undefined) return empty;
  const trimmed = value.trim();
  if (trimmed === '' || /^(?:[—–]|-{1,3})$/.test(trimmed)) return empty;
  return value.replace(SPACED_DASH, ' · ').replace(BARE_LONG_DASH, ' · ');
}
