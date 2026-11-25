/**
 * Pure helpers for typed quantities in output cells (docs/programs/SPEC.md 5.9, B.2). The words
 * come from the engine message table so imports, the planner and the log dialog say the same thing.
 */
import { fromScaled, quantityToScaled, readQtyCell } from '@kitstak/programs-engine';

export type QtyRead = { readonly ok: true; readonly qty: string | null } | { readonly ok: false; readonly message: string };

/**
 * Reads what a person typed in a qty cell. Empty means "no entry" (null). Commas are allowed
 * ("1,200"). The value is returned as a 3 decimal string.
 */
export function readQty(text: string, what: 'qty' | 'scrap' = 'qty', where?: string): QtyRead {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, qty: null };
  const read = readQtyCell(trimmed, what, where);
  if ('why' in read) return { ok: false, message: read.why };
  return { ok: true, qty: fromScaled(quantityToScaled(read.plain), 3) };
}

/** Remaining to plan, never below zero, as plain text for an input ("40"). */
export function remainingText(planned: string, builtBefore: string): string {
  const rest = quantityToScaled(planned) - quantityToScaled(builtBefore);
  if (rest <= BigInt(0)) return '0';
  return trimQty(fromScaled(rest, 3));
}

/** "40.000" to "40", "12.500" to "12.5". */
export function trimQty(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '');
}
