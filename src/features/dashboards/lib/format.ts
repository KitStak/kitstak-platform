/** Number formatting for widgets: compact display values plus exact values for tooltips. */
import type { InsightValueColumn, NumberFormat } from '@/server/services/contracts/dashboard-insights';

export interface ValueFormat {
  readonly format: NumberFormat;
  readonly currency?: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly unit?: string;
}

/** Resolve how a widget formats values from its settings and the measured column. */
export function resolveFormat(
  settings: { format: NumberFormat; prefix?: string; suffix?: string },
  column: InsightValueColumn | null,
  aggregate: string,
): ValueFormat {
  const isCount = aggregate === 'count' || !column;
  const currency = !isCount && (settings.format === 'currency' || column?.type === 'currency') ? (column?.currency ?? 'USD') : undefined;
  const prefix = currency && settings.prefix && currencySymbol(currency) === settings.prefix.trim() ? undefined : settings.prefix;
  return {
    format: currency ? 'currency' : settings.format === 'currency' ? 'number' : settings.format,
    currency,
    prefix,
    suffix: settings.suffix,
    unit: !isCount && !currency ? column?.unit : undefined,
  };
}

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** 1234 → "1.2K", 1_250_000 → "1.25M". Values under 10k keep their digits. */
export function abbreviate(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  if (abs < 10_000) return `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: abs < 10 ? 2 : abs < 100 ? 1 : 0 })}`;
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = abs / size;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${sign}${Number(scaled.toFixed(digits)).toString()}${suffix}`;
    }
  }
  return `${sign}${abs}`;
}

function wrap(body: string, format: ValueFormat): string {
  const unit = format.unit ? (format.unit === '%' ? format.unit : ` ${format.unit}`) : '';
  return `${format.prefix ?? ''}${body}${unit}${format.suffix ?? ''}`;
}

/** Compact display ("$1.25M", "64%", "1.2K deals"). */
export function formatCompact(value: number, format: ValueFormat): string {
  if (format.format === 'percent') return wrap(`${Math.round(value * 10) / 10}%`, format);
  if (format.currency) {
    const symbol = currencySymbol(format.currency);
    const sign = value < 0 ? '-' : '';
    return wrap(`${sign}${symbol}${abbreviate(Math.abs(value))}`, format);
  }
  return wrap(abbreviate(value), format);
}

/** Exact display for tooltips ("$1,250,000"). */
export function formatExact(value: number, format: ValueFormat): string {
  if (format.format === 'percent') return wrap(`${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`, format);
  if (format.currency) {
    try {
      return wrap(
        new Intl.NumberFormat('en-US', { style: 'currency', currency: format.currency, maximumFractionDigits: 0 }).format(value),
        format,
      );
    } catch {
      return wrap(`${value.toLocaleString('en-US')} ${format.currency}`, format);
    }
  }
  return wrap(value.toLocaleString('en-US', { maximumFractionDigits: 2 }), format);
}

/** Relative change between two values (null when there is no baseline). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

const AGGREGATE_LABEL: Record<string, string> = {
  count: 'Count',
  sum: 'Sum',
  average: 'Average',
  median: 'Median',
  min: 'Minimum',
  max: 'Maximum',
};

/** "Sum of Deal value across 2 boards" / "Count of items on Deals". */
export function describeAggregate(aggregate: string, column: InsightValueColumn | null, boards: readonly { name: string }[]): string {
  const what = aggregate === 'count' || !column ? 'Count of items' : `${AGGREGATE_LABEL[aggregate] ?? 'Sum'} of ${column.title}`;
  if (boards.length === 0) return what;
  return boards.length === 1 ? `${what} on ${boards[0]?.name}` : `${what} across ${boards.length} boards`;
}
