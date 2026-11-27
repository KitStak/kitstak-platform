/**
 * Words and small math the program screens share: month and day names, unit words, the health
 * words and tones, margin tone against the customer's target, and exact sums of quantities.
 * Pure, so the screens, the report and the tests read the same words.
 */
import type { PillTone } from '@kitstak/ui/dashboard';
import { fromScaled, quantityToScaled, ZERO } from '@/lib/money';
import { addMonths, weekday } from '@/lib/profit/calendar';
import type { ProgramHealth, ProgramUnitDTO } from '@/lib/program-types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "November 2026" from `2026-11`. */
export function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${MONTHS[index] ?? month} ${month.slice(0, 4)}`;
}

/** "Nov 2026" from `2026-11`. */
export function monthShort(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${(MONTHS[index] ?? month).slice(0, 3)} ${month.slice(0, 4)}`;
}

/** "Mon, Nov 2" from `2026-11-02`. */
export function dayLabel(date: string): string {
  const index = Number(date.slice(5, 7)) - 1;
  return `${DAYS_SHORT[weekday(date)] ?? ''}, ${(MONTHS[index] ?? '').slice(0, 3)} ${Number(date.slice(8, 10))}`;
}

/** The month `count` months from `month` (`YYYY-MM`). */
export function addMonth(month: string, count: number): string {
  return addMonths(`${month}-01`, count).slice(0, 7);
}

/** The months a month picker offers, newest first: `back` months before `latest`, then `latest`. */
export function monthChoices(latest: string, back = 23): string[] {
  return Array.from({ length: back + 1 }, (_, index) => addMonth(latest, -index));
}

/** The unit word for a count: "1 kit", "14,412 kits". */
export function unitWord(unit: ProgramUnitDTO, quantity: string | number | null): string {
  return Number(quantity) === 1 ? unit.singular : unit.plural;
}

/** "Kits" from "kits": a column or tile label. */
export function capitalize(word: string): string {
  return word ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word;
}

export const HEALTH_LABELS: Readonly<Record<ProgramHealth, string>> = {
  on_track: 'On track',
  heads_up: 'Heads up',
  at_risk: 'At risk',
  losing: 'Losing money',
  no_data: 'No work yet',
};

/** Five tones, no more (docs/design/UI-CLEANUP.md). A heads up is neutral: the word carries it. */
export const HEALTH_TONES: Readonly<Record<ProgramHealth, PillTone>> = {
  on_track: 'positive',
  heads_up: 'neutral',
  at_risk: 'caution',
  losing: 'critical',
  no_data: 'neutral',
};

/** Worst first, for sorting by health. */
export const HEALTH_ORDER: Readonly<Record<ProgramHealth, number>> = { losing: 0, at_risk: 1, heads_up: 2, on_track: 3, no_data: 4 };

/** The status chip tone: running is positive, paused is caution, the rest neutral. */
export function statusTone(status: string): PillTone {
  if (status === 'active') return 'positive';
  if (status === 'on_hold') return 'caution';
  return 'neutral';
}

/** A margin against the customer's target, the way the Jobs list colors it: losing money is bad, at or above target is good. */
export function marginTone(marginBp: number | null | undefined, targetBp: number | null | undefined): 'good' | 'bad' | 'neutral' {
  if (marginBp === null || marginBp === undefined) return 'neutral';
  if (marginBp < 0) return 'bad';
  if (targetBp !== null && targetBp !== undefined && marginBp >= targetBp) return 'good';
  return 'neutral';
}

export function toneText(tone: 'good' | 'bad' | 'neutral'): string {
  return tone === 'good' ? 'text-success-text' : tone === 'bad' ? 'text-danger-text' : 'text-fg';
}

/** Exact sum of 3 place quantities ("14412.000"), as a 3 place string. */
export function sumQuantities(values: Iterable<string | null | undefined>): string {
  let total = ZERO;
  for (const value of values) if (value !== null && value !== undefined && value !== '') total += quantityToScaled(value);
  return fromScaled(total, 3);
}

/** Exact sum of whole cents. Null when every value is null (money hidden). */
export function sumMoney(values: Iterable<number | null | undefined>): number | null {
  let total = ZERO;
  let any = false;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    any = true;
    total += BigInt(value);
  }
  return any ? Number(total) : null;
}

/** Units against plan as a 0 to 1 share for a meter. 0 when nothing is planned. */
export function shareOfPlan(units: string | null | undefined, planned: string | null | undefined): number {
  const plan = Number(planned ?? 0);
  if (!Number.isFinite(plan) || plan <= 0) return 0;
  return Math.max(0, Math.min(1, Number(units ?? 0) / plan));
}
