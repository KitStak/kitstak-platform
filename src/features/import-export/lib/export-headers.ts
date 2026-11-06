/**
 * Recognizes the helper columns KitStak's own exports add, so re-importing an export
 * round-trips instead of creating junk columns:
 *
 * - `Group`             → rows are routed into groups by title
 * - `<X> (emails)`      → the people source for `<X>` (matched by email; the names column is skipped)
 * - `<X> (currency)`    → the per-row currency code for the `<X>` amount column (skipped itself)
 */

export interface ExportHelpers {
  /** Index of the `Group` column, if any. */
  readonly group: number | null;
  /** Base people column index → its `(emails)` companion index. */
  readonly peopleEmails: ReadonlyMap<number, number>;
  /** Base amount column index → its `(currency)` companion index. */
  readonly currencyCodes: ReadonlyMap<number, number>;
}

const SUFFIX = /^(.*\S)\s+\((emails|currency)\)$/i;

export function detectExportHelpers(headers: readonly string[]): ExportHelpers {
  const byTitle = new Map<string, number>();
  headers.forEach((header, index) => {
    const key = header.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, index);
  });
  const peopleEmails = new Map<number, number>();
  const currencyCodes = new Map<number, number>();
  headers.forEach((header, index) => {
    const match = SUFFIX.exec(header.trim());
    if (!match) return;
    const base = byTitle.get((match[1] as string).toLowerCase());
    if (base === undefined || base === index) return;
    if ((match[2] as string).toLowerCase() === 'emails') peopleEmails.set(base, index);
    else currencyCodes.set(base, index);
  });
  const groupIndex = headers.findIndex((header) => header.trim().toLowerCase() === 'group');
  // Only treat "Group" as KitStak's helper when the file also looks like a KitStak export
  // (it is always the second column there) or carries other helper columns.
  const looksLikeExport = groupIndex === 1 || peopleEmails.size > 0 || currencyCodes.size > 0;
  return { group: groupIndex >= 0 && looksLikeExport ? groupIndex : null, peopleEmails, currencyCodes };
}

/** Companion indexes that should never be imported as columns of their own. */
export function helperCompanions(helpers: ExportHelpers): Set<number> {
  return new Set([...helpers.peopleEmails.values(), ...helpers.currencyCodes.values()]);
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

/** Per-row currency code from a `(currency)` companion cell, when it holds a valid ISO code. */
export function currencyFromCompanion(value: string | undefined): string | null {
  const code = value?.trim().toUpperCase() ?? '';
  return ISO_CURRENCY.test(code) ? code : null;
}
