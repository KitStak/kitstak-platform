"use client";

/**
 * Inventory date rendering (M06). Two kinds of value reach the inventory screens:
 *
 *   - calendar dates (expiry, production) stored as "YYYY-MM-DD". They have no time and no
 *     timezone, so they are read as a local calendar day and never shifted. `new Date("2026-02-28")`
 *     is UTC midnight and renders as 2/27 west of Greenwich, which is the bug this file avoids.
 *   - instants (received, transaction time) stored as ISO timestamps. They are shown in the
 *     viewer's local time with the grid pattern ("11/09/2026 10:46 PM"), and the date-only form
 *     of an instant ("Rcvd 11/09/2026") uses the same local calendar day.
 *
 * Every inventory grid, drawer, card and sub-label goes through these helpers so one row shows
 * one date, whatever the surface.
 */
import * as React from "react";
import { EMPTY_VALUE, formatPattern, gridDateTimePattern, useFormat, type FormatPreferences } from "@/lib/format";

const CALENDAR_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.000)?Z?$)/;

/** "2026-02-28" → local Date for Feb 28 (no UTC shift). Null for empty or impossible dates. */
export function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = CALENDAR_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

/** The date part of the user's pattern, zero-padded like the grid ("MM/DD/YYYY"). */
export function gridDatePattern(prefs: Pick<FormatPreferences, "dateFormat">): string {
  const pattern = gridDateTimePattern(prefs.dateFormat);
  const idx = pattern.search(/\s+[Hh]/);
  return idx > 0 ? pattern.slice(0, idx) : pattern;
}

/** Calendar date ("2026-02-28") in the grid date pattern ("02/28/2026"). Invalid input → the raw string. */
export function formatCalendarDate(value: string | null | undefined, prefs: Pick<FormatPreferences, "dateFormat">): string {
  if (!value) return EMPTY_VALUE;
  const d = parseCalendarDate(value);
  return d ? formatPattern(d, gridDatePattern(prefs)) : value;
}

/** Local calendar day of an instant, in the grid date pattern. */
export function formatInstantDate(value: string | null | undefined, prefs: Pick<FormatPreferences, "dateFormat">): string {
  if (!value) return EMPTY_VALUE;
  return formatPattern(value, gridDatePattern(prefs));
}

/**
 * Grid cell for expiry / production dates. With `tracked={false}` (the product does not track
 * the attribute) a leftover value is not shown as if it were real: the cell reads "-" and the
 * tooltip names the stored value, which the hygiene repair clears once the units are free.
 */
export function CalendarDateCell({ value, tracked = true }: { readonly value: string | null | undefined; readonly tracked?: boolean }) {
  const fmt = useFormat();
  if (!value) return <span className="text-faint">{EMPTY_VALUE}</span>;
  if (!tracked) {
    return <span className="text-faint" title={`Not tracked for this SKU (stored value ${formatCalendarDate(value, fmt.prefs)} is cleared when these units are free)`}>{EMPTY_VALUE}</span>;
  }
  return <span className="whitespace-nowrap tabular-nums text-body">{formatCalendarDate(value, fmt.prefs)}</span>;
}

/** Hook form for non-cell surfaces (cards, drawers, sub-labels). */
export function useInventoryDates() {
  const fmt = useFormat();
  return React.useMemo(
    () => ({
      calendar: (v: string | null | undefined) => formatCalendarDate(v, fmt.prefs),
      instantDate: (v: string | null | undefined) => formatInstantDate(v, fmt.prefs),
      instant: (v: string | null | undefined) => (v ? fmt.gridDateTime(v) : EMPTY_VALUE),
      instantFull: (v: string | null | undefined) => (v ? fmt.dateTime(v) : EMPTY_VALUE),
    }),
    [fmt],
  );
}
