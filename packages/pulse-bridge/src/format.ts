/**
 * Formatting for Pulse numbers shown inside sibling apps. Fixed `en-US` locale so the server
 * and the browser print the same text. No math: these only turn a stored number into words.
 */

/** Whole cents to money text: 1234567 becomes "$12,346" (or "$12,345.67" with `cents`). */
export function formatCents(cents: number | null | undefined, options: { readonly cents?: boolean; readonly currency?: string; readonly empty?: string } = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return options.empty ?? 'Hidden';
  const digits = options.cents ? 2 : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: options.currency ?? 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/** Basis points to percent text: 3150 becomes "31.5%". */
export function formatMarginBp(bp: number | null | undefined, options: { readonly empty?: string } = {}): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return options.empty ?? 'No margin yet';
  const tenths = Math.round(bp / 10) / 10;
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(tenths)}%`;
}

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
