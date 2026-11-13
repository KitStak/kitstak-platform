/**
 * Change-log sentence format, one place for every writer and reader.
 *
 * Stored messages read "<Label> is modified. <from> → <to>", with "None" for an empty side.
 * Brand rule: no em dashes and no double dashes in anything a person can read, and change-log
 * messages are shown on screen, in exports and in reports. Rows written before this format
 * used the Logiwa wire form ("Status is modified. — --> Ready"); readers accept both through
 * `CHANGE_ARROW_RE` and `isEmptySide`, and migration 0011 rewrites the stored rows.
 */

/** Arrow between the old and the new value. */
export const CHANGE_ARROW = '→';

/** An empty side of a change ("Note is modified. None → Leave at door"). */
export const CHANGE_EMPTY = 'None';

/** Matches the arrow in new ("→") and legacy ("-->") messages, with surrounding spaces. */
export const CHANGE_ARROW_RE = /\s*(?:-->|→)\s*/;

/** "Status is modified. Open → Closed". */
export function modifiedMessage(label: string, from: string, to: string): string {
  return `${label} is modified. ${from} ${CHANGE_ARROW} ${to}`;
}

/** True for a side that means "no value": blank, "None", or the legacy dash glyphs. */
export function isEmptySide(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const v = value.trim();
  return v === '' || v === CHANGE_EMPTY || /^[\u2014\u2013-]$/.test(v);
}
