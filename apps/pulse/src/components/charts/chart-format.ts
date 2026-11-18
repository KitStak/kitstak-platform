/**
 * How a chart turns its numbers into words. Charts take plain numbers for geometry and one of
 * these formats for every label, tooltip and table cell, so the text always comes from
 * `src/lib/format.ts` and matches the rest of Pulse.
 *
 * Presets: `money` (values are cents), `percent` (values are basis points: 2236 is 22.4%),
 * `number`, `hours`. Pass `{ axis, value }` for anything else.
 */
import { formatCompactNumber, formatHours, formatMoney, formatMoneyCompact, formatMoneyWhole, formatNumber, formatPercentBp } from '@/lib/format';

export interface ChartFormatter {
  /** Short text for axis ticks and labels on marks: "$48.2K". */
  readonly axis: (value: number) => string;
  /** Full text for tooltips and the data table: "$48,210". */
  readonly value: (value: number) => string;
}

export type ChartFormatPreset = 'money' | 'percent' | 'number' | 'hours';
export type ChartFormat = ChartFormatPreset | ChartFormatter;

const PRESETS: Readonly<Record<ChartFormatPreset, ChartFormatter>> = {
  money: {
    // Under $1,000 compact notation shows half dollars ("-$502.5"): whole dollars read better.
    axis: (value) => (Math.abs(value) < 100_000 ? formatMoneyWhole(Math.round(value)) : formatMoneyCompact(Math.round(value))),
    // Cents matter on small amounts and are noise on big ones.
    value: (value) => (Math.abs(value) >= 100_000 ? formatMoneyWhole(Math.round(value)) : formatMoney(Math.round(value))),
  },
  percent: {
    axis: (value) => formatPercentBp(value, { digits: Math.abs(value) < 1000 && value % 100 !== 0 ? 1 : 0 }),
    value: (value) => formatPercentBp(value, { digits: 1 }),
  },
  number: {
    axis: (value) => (Math.abs(value) >= 10_000 ? formatCompactNumber(value) : formatNumber(value, { maxDigits: 1 })),
    value: (value) => formatNumber(value, { maxDigits: 2 }),
  },
  hours: {
    axis: (value) => (Math.abs(value) >= 10_000 ? `${formatCompactNumber(value)} h` : formatHours(value, { style: 'short', maxDigits: 1 })),
    value: (value) => formatHours(value, { style: 'unit', maxDigits: 2 }),
  },
};

export function resolveFormat(format: ChartFormat | undefined): ChartFormatter {
  if (!format) return PRESETS.number;
  return typeof format === 'string' ? PRESETS[format] : format;
}

/** A value with its sign spelled out, for bridges and changes: "+$1,200", "-$800". Zero has no sign. */
export function signed(text: string, value: number): string {
  if (value > 0) return `+${text}`;
  return text;
}

/**
 * Turns a DTO number into a chart number. Money DTO fields are whole cents (`number | null`),
 * decimals arrive as strings. `null`, empty and hidden values stay `null` so the chart draws a gap.
 */
export function chartNumber(value: number | bigint | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The series color for slot `index` (0 based). Past eight the tail shares the neutral: fold it into "Other" first. */
export function seriesColor(index: number): string {
  return index >= 0 && index < 8 ? `var(--pulse-series-${index + 1})` : 'var(--pulse-chart-neutral)';
}

export const CHART_COLORS = {
  neutral: 'var(--pulse-chart-neutral)',
  up: 'var(--pulse-chart-up)',
  down: 'var(--pulse-chart-down)',
  grid: 'var(--pulse-chart-grid)',
  axis: 'var(--pulse-chart-axis)',
  track: 'var(--pulse-chart-track)',
  ink: 'var(--text-primary)',
  surface: 'var(--surface-panel)',
} as const;
