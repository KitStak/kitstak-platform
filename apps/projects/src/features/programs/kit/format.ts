/**
 * Pure text and tone helpers for the program UI kit (docs/programs/SPEC.md 5). Every money and
 * quantity string comes from the engine format helpers, so Projects, Pulse and CRM print the same
 * numbers. No React here: these are unit tested in `format.test.ts`.
 */
import { formatCents, formatQty, quantityToScaled, shortDate, unitLabel, weekday } from '@kitstak/programs-engine';
import type { Health, HealthBasis, IsoDate, RunState, UnitLabel } from '@/lib/program-types';
import type { LabelColor } from '@/lib/constants';
import { LABEL_COLORS } from '@/lib/constants';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "Wed Nov 25". */
export function dayLabel(date: IsoDate): string {
  return `${WEEKDAY_SHORT[weekday(date)]} ${shortDate(date)}`;
}

/** "Nov 23 to Nov 29", or one day when both ends match. */
export function rangeLabel(from: IsoDate, to: IsoDate): string {
  return from === to ? dayLabel(from) : `${shortDate(from)} to ${shortDate(to)}`;
}

/** Safe 3 decimal scaled quantity (0 for text that is not a number). */
export function scaledQty(value: string | null | undefined): bigint {
  if (!value) return BigInt(0);
  try {
    return quantityToScaled(value);
  } catch {
    return BigInt(0);
  }
}

/** Built over planned as a 0 to 100 number for a progress bar (display only, never money). */
export function qtyPercent(built: string, planned: string): number {
  const p = scaledQty(planned);
  if (p <= BigInt(0)) return scaledQty(built) > BigInt(0) ? 100 : 0;
  const ratio = (scaledQty(built) * BigInt(1000)) / p;
  return Math.min(100, Number(ratio) / 10);
}

export type QtyTone = 'primary' | 'success' | 'warning';

/** Success when the build is full, warning when it went over plan. */
export function qtyTone(built: string, planned: string): QtyTone {
  const b = scaledQty(built);
  const p = scaledQty(planned);
  if (p > BigInt(0) && b > p) return 'warning';
  if (p > BigInt(0) && b === p) return 'success';
  return 'primary';
}

/** "60 of 100 kits". */
export function qtyOfText(built: string, planned: string, unit: UnitLabel): string {
  return `${formatQty(built)} of ${unitLabel(planned, unit)}`;
}

/** "5 of 8 builds done". */
export function doneOfText(done: number, total: number, noun: 'builds' | 'done' = 'builds'): string {
  if (noun === 'done') return `${done} of ${total} done`;
  return `${done} of ${total} ${total === 1 ? 'build' : 'builds'} done`;
}

/** "Wed Nov 25 · Weekday glove run · 560 of 800 kits · 5 of 8 done". */
export function runLineText(run: { readonly date: IsoDate; readonly name: string; readonly builtUnits: string; readonly plannedUnits: string; readonly done: number; readonly builds: number }, unit: UnitLabel, options: { readonly withDate?: boolean } = {}): string {
  const parts = [run.name, qtyOfText(run.builtUnits, run.plannedUnits, unit), doneOfText(run.done, run.builds, 'done')];
  return (options.withDate === false ? parts : [dayLabel(run.date), ...parts]).join(' · ');
}

export const RUN_STATE_TEXT: Readonly<Record<RunState, string>> = {
  planned: 'Planned',
  in_progress: 'Building',
  done: 'Done',
  short: 'Short',
  cancelled: 'Cancelled',
};

export const RUN_STATE_TONE: Readonly<Record<RunState, 'neutral' | 'info' | 'success' | 'warning' | 'outline'>> = {
  planned: 'neutral',
  in_progress: 'info',
  done: 'success',
  short: 'warning',
  cancelled: 'outline',
};

export type TargetTone = 'success' | 'warning' | 'danger';

/** 100% and up success, 90% to 99% warning, under 90% danger (SPEC 5.3). */
export function targetTone(bp: number): TargetTone {
  if (bp >= 10_000) return 'success';
  if (bp >= 9_000) return 'warning';
  return 'danger';
}

/** "105% of target" (whole percent, rounded half up). */
export function targetText(bp: number): string {
  return `${Math.round(bp / 100)}% of target`;
}

export const HEALTH_TEXT: Readonly<Record<Health, string>> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/** The tip that says what the health is based on. */
export function healthBasisText(basis: HealthBasis | null, auto: boolean): string {
  if (!auto) return 'Set by hand by an owner.';
  switch (basis) {
    case 'money_target':
      return 'Based on the forecast against the monthly revenue target.';
    case 'unit_target':
      return 'Based on units this month against the daily unit target.';
    case 'plan':
      return 'Based on units built against planned builds this month.';
    default:
      return 'Not enough data yet to judge health.';
  }
}

/** "Closed through Oct 31". */
export function lockText(lockedThrough: IsoDate): string {
  return `Closed through ${shortDate(lockedThrough)}`;
}

/** Money text, or null when the person cannot see money. */
export function moneyOrNull(cents: string | null | undefined, options: { readonly cents?: boolean; readonly compact?: boolean } = {}): string | null {
  if (cents === null || cents === undefined) return null;
  return formatCents(cents, { cents: options.cents ?? true, compact: options.compact });
}

const COLOR_ALIASES: Readonly<Record<string, LabelColor>> = { amber: 'orange', gold: 'yellow', navy: 'dark-blue', violet: 'purple', cyan: 'teal', crimson: 'red', grey: 'gray' };

/** A program or variant color as a label palette name (unknown names fall back). */
export function paletteColor(color: string | null | undefined, fallback: LabelColor = 'orange'): LabelColor {
  if (!color) return fallback;
  if ((LABEL_COLORS as readonly string[]).includes(color)) return color as LabelColor;
  return COLOR_ALIASES[color.toLowerCase()] ?? fallback;
}

/** First letters for a key chip when no icon is set. */
export function keyInitials(key: string): string {
  return key.slice(0, 2).toUpperCase();
}
