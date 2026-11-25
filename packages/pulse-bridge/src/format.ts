/**
 * Formatting for Pulse numbers shown inside sibling apps. Fixed `en-US` locale so the server
 * and the browser print the same text. No math: these only turn a stored number into words.
 */

/**
 * `formatCents` and `formatMarginBp` come from the shared engine (docs/programs/SPEC.md 3.12), so
 * Pulse money shown in CRM, WMS and Projects prints exactly like program money. `formatCents`
 * takes whole cents as a number, a `bigint` or an integer string.
 */
export { formatCents, formatMarginBp } from '@kitstak/programs-engine/format';

/** A decimal string quantity to a whole or one decimal number text. */
export function formatQuantity(value: string | number | null | undefined): string {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(parsed);
}

export type PulseTone = 'good' | 'watch' | 'warn' | 'bad' | 'quiet';

/** The color family for a job's health. Words always go with it, never color alone. */
export function statusTone(risk: string | null | undefined): PulseTone {
  switch (risk) {
    case 'on_track':
      return 'good';
    case 'heads_up':
      return 'watch';
    case 'at_risk':
      return 'warn';
    case 'losing':
      return 'bad';
    default:
      return 'quiet';
  }
}
