'use client';
/**
 * The named cartesian charts. Each one is a thin, typed layer over the shared engine in `xy.tsx`:
 * LineChart, AreaChart, BarChart (vertical here, horizontal in `hbar.tsx`), ComboChart,
 * WaterfallChart and ParetoChart.
 */
import { CHART_COLORS, resolveFormat, seriesColor, signed, type ChartFormat } from './chart-format';
import type { ChartBaseProps } from './frame';
import { HorizontalBars } from './hbar';
import { formatDateLong, formatDateTick, type TimeBucket } from './scale';
import { XYChart, type XYCategory, type XYFloat, type XYSeries } from './xy';

export interface ChartSeries {
  readonly id: string;
  readonly label: string;
  /** One value per x position. `null` is a gap ("no data"), never zero. */
  readonly values: readonly (number | null)[];
  /** Words for a gap at that position in the tooltip and the table ("Not known"). Left out, a gap reads "No data". */
  readonly gapText?: readonly (string | null)[];
  /** A CSS color. Leave it out to take the next palette slot. */
  readonly color?: string;
}

export interface ChartTarget {
  readonly value: number;
  /** Short name on the line: "Target", "Plan", "Break even". */
  readonly label: string;
}

/** The x axis: plain labels, or `YYYY-MM-DD` bucket starts with the bucket size. */
export interface ChartXProps {
  readonly labels?: readonly string[];
  /** Evenly spaced bucket starts, oldest first (`bucketStarts` in `@/lib/profit` makes them). */
  readonly dates?: readonly string[];
  readonly bucket?: TimeBucket;
}

function toCategories({ labels, dates, bucket = 'day' }: ChartXProps): { categories: XYCategory[]; timeAxis: boolean } {
  if (dates) {
    return {
      timeAxis: true,
      categories: dates.map((date, index) => ({ key: `${date}-${index}`, label: formatDateTick(date, bucket, dates[index - 1]), long: formatDateLong(date, bucket) })),
    };
  }
  return { timeAxis: false, categories: (labels ?? []).map((label, index) => ({ key: `${index}-${label}`, label, long: label })) };
}

function withColors(series: readonly ChartSeries[], offset = 0): XYSeries[] {
  return series.map((item, index) => ({ id: item.id, label: item.label, values: item.values, gapText: item.gapText, color: item.color ?? seriesColor(index + offset) }));
}

// --- Line and area ------------------------------------------------------------------------

export interface LineChartProps extends ChartBaseProps, ChartXProps {
  readonly series: readonly ChartSeries[];
  readonly format?: ChartFormat;
  readonly target?: ChartTarget;
  /** Start the value axis at zero. Default `false` for lines, `true` for areas. */
  readonly zeroBased?: boolean;
}

/** One or more lines over time or categories. Gaps stay gaps; a single point draws a dot. */
export function LineChart({ series, format, target, zeroBased, labels, dates, bucket, ...base }: LineChartProps) {
  const x = toCategories({ labels, dates, bucket });
  return <XYChart {...base} {...x} lines={withColors(series)} format={resolveFormat(format)} target={target} zeroBased={zeroBased} />;
}

/** Lines with a light wash down to zero. Use it for amounts that pile up (revenue, units, hours). */
export function AreaChart({ series, format, target, zeroBased = true, labels, dates, bucket, ...base }: LineChartProps) {
  const x = toCategories({ labels, dates, bucket });
  return <XYChart {...base} {...x} lines={withColors(series)} area format={resolveFormat(format)} target={target} zeroBased={zeroBased} />;
}

// --- Bars ---------------------------------------------------------------------------------

export interface BarChartProps extends ChartBaseProps, ChartXProps {
  readonly series: readonly ChartSeries[];
  /** `grouped` puts series side by side, `stacked` piles them (values under zero pile downward). */
  readonly mode?: 'grouped' | 'stacked';
  /** `horizontal` suits rankings and long names. */
  readonly orientation?: 'vertical' | 'horizontal';
  readonly format?: ChartFormat;
  readonly target?: ChartTarget;
  /** Print the value at the end of each bar when it fits. */
  readonly showValues?: boolean;
  /** One series only: bars under zero turn the loss color. They also sit under the zero line, so color is never the only cue. */
  readonly signColors?: boolean;
}

export function BarChart({ series, mode = 'grouped', orientation = 'vertical', format, target, showValues, signColors, labels, dates, bucket, ...base }: BarChartProps) {
  const x = toCategories({ labels, dates, bucket });
  const bars = withColors(series);
  if (orientation === 'horizontal') {
    return <HorizontalBars {...base} categories={x.categories} series={bars} mode={mode} format={resolveFormat(format)} target={target} showValues={showValues ?? true} signColors={signColors} />;
  }
  return <XYChart {...base} {...x} bars={bars} barMode={mode} format={resolveFormat(format)} target={target} showValues={showValues} signColors={signColors} />;
}

// --- Combo --------------------------------------------------------------------------------

export interface ComboChartProps extends ChartBaseProps, ChartXProps {
  readonly bars: readonly ChartSeries[];
  readonly barMode?: 'grouped' | 'stacked';
  readonly lines: readonly ChartSeries[];
  readonly barFormat?: ChartFormat;
  readonly lineFormat?: ChartFormat;
  /** A target on the line scale ("Target margin"). */
  readonly lineTarget?: ChartTarget;
  /**
   * `split` (default) draws the line in its own panel above the bars on one shared x axis, so
   * two different units never look related by accident. `overlay` draws the line across the
   * bars with its scale on the right.
   */
  readonly layout?: 'split' | 'overlay';
}

/** Bars and a line with a different unit, for example revenue bars with a margin percent line. */
export function ComboChart({ bars, barMode, lines, barFormat, lineFormat, lineTarget, layout = 'split', labels, dates, bucket, ...base }: ComboChartProps) {
  const x = toCategories({ labels, dates, bucket });
  return (
    <XYChart
      {...base}
      {...x}
      bars={withColors(bars)}
      barMode={barMode}
      lines={withColors(lines, bars.length)}
      lineScale="own"
      layout={layout}
      format={resolveFormat(barFormat)}
      lineFormat={resolveFormat(lineFormat)}
      target={lineTarget ? { ...lineTarget, on: 'lines' } : undefined}
    />
  );
}

// --- Waterfall ----------------------------------------------------------------------------

export interface WaterfallStep {
  readonly id: string;
  readonly label: string;
  /** Change from the step before: above zero adds, below zero takes away. */
  readonly value: number;
}

export interface WaterfallChartProps extends ChartBaseProps {
  readonly start: { readonly label: string; readonly value: number };
  readonly steps: readonly WaterfallStep[];
  /** Label of the last bar. Its value is always the start plus every step, so the bridge adds up. */
  readonly endLabel: string;
  readonly format?: ChartFormat;
  /** `false` for cost bridges, where a rise is bad news. Default `true`. */
  readonly upIsGood?: boolean;
}

/**
 * A bridge from one total to another: planned profit, then price, volume, labor rate, labor
 * efficiency, material and other, ending at actual profit. Every bar carries its signed amount,
 * so direction never rests on color.
 */
export function WaterfallChart({ start, steps, endLabel, format, upIsGood = true, ...base }: WaterfallChartProps) {
  const fmt = resolveFormat(format);
  const good = CHART_COLORS.up;
  const bad = CHART_COLORS.down;
  let running = start.value;
  const floats: XYFloat[] = [{ from: 0, to: start.value, color: CHART_COLORS.neutral, kind: 'total', text: fmt.axis(start.value), longText: fmt.value(start.value) }];
  const categories: XYCategory[] = [{ key: 'start', label: start.label, long: start.label }];
  for (const step of steps) {
    const from = running;
    running += step.value;
    const kind = step.value > 0 ? 'up' : step.value < 0 ? 'down' : 'flat';
    floats.push({
      from,
      to: running,
      kind,
      color: kind === 'flat' ? CHART_COLORS.neutral : (kind === 'up') === upIsGood ? good : bad,
      text: signed(fmt.axis(step.value), step.value),
      longText: signed(fmt.value(step.value), step.value),
    });
    categories.push({ key: step.id, label: step.label, long: step.label });
  }
  floats.push({ from: 0, to: running, color: CHART_COLORS.neutral, kind: 'total', text: fmt.axis(running), longText: fmt.value(running) });
  categories.push({ key: 'end', label: endLabel, long: endLabel });
  const end = running;
  const runningAt = (index: number): number => floats[index]?.to ?? end;
  return (
    <XYChart
      {...base}
      categories={categories}
      floats={floats}
      format={fmt}
      legendExtra={[
        { id: 'total', label: 'Total', color: CHART_COLORS.neutral, shape: 'box' },
        { id: 'up', label: upIsGood ? 'Adds (+)' : 'Adds cost (+)', color: upIsGood ? good : bad, shape: 'box' },
        { id: 'down', label: upIsGood ? 'Takes away (-)' : 'Saves (-)', color: upIsGood ? bad : good, shape: 'box' },
      ]}
      extraRows={(index) => (floats[index]?.kind === 'total' ? [] : [{ id: 'running', label: 'Running total', value: fmt.value(runningAt(index)), muted: true }])}
      tableColumns={['Step', 'Change', 'Running total']}
      tableRow={(index) => [categories[index]?.long ?? '', floats[index]?.kind === 'total' ? 'Total' : (floats[index]?.longText ?? ''), fmt.value(runningAt(index))]}
      rovingStart="first"
    />
  );
}

// --- Pareto -------------------------------------------------------------------------------

export interface ParetoItem {
  readonly id: string;
  readonly label: string;
  /** Size of the cause (cost, hours, count). Values at or under zero are left out. */
  readonly value: number;
}

export interface ParetoChartProps extends ChartBaseProps {
  readonly items: readonly ParetoItem[];
  readonly format?: ChartFormat;
  /** Most bars to draw. The rest fold into one "Other" bar at the end. Default 8. */
  readonly maxItems?: number;
  /** Name of the bar series in the tooltip and table ("Extra cost"). */
  readonly valueLabel?: string;
}

/**
 * Biggest causes first, with a line for the running share of the total. Bars and line share one
 * scale: the right axis is the same axis in percent of the total, and a marker shows 80%.
 */
export function ParetoChart({ items, format, maxItems = 8, valueLabel = 'Amount', ...base }: ParetoChartProps) {
  const fmt = resolveFormat(format);
  const sorted = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, sorted.length > maxItems ? maxItems - 1 : maxItems);
  const tail = sorted.slice(head.length);
  const rows = tail.length ? [...head, { id: 'other', label: `Other (${tail.length})`, value: tail.reduce((sum, item) => sum + item.value, 0) }] : head;
  const total = rows.reduce((sum, item) => sum + item.value, 0);
  const cumulative = rows.map((_, index) => rows.slice(0, index + 1).reduce((sum, item) => sum + item.value, 0));
  const share = (value: number): string => `${Math.round((value / (total || 1)) * 100)}%`;
  return (
    <XYChart
      {...base}
      categories={rows.map((item) => ({ key: item.id, label: item.label, long: item.label }))}
      bars={[{ id: 'value', label: valueLabel, values: rows.map((item) => item.value), color: seriesColor(0) }]}
      lines={[{ id: 'cumulative', label: 'Running share of total', values: cumulative, color: seriesColor(1) }]}
      format={{ axis: fmt.axis, value: fmt.value }}
      lineFormat={{ axis: share, value: (value) => `${share(value)} (${fmt.value(value)})` }}
      domain={total > 0 ? [0, total] : undefined}
      rightTicks={total > 0 ? [0, 0.5, 1].map((part) => ({ value: total * part, label: `${Math.round(part * 100)}%` })) : undefined}
      referenceLines={total > 0 && rows.length > 1 ? [{ value: total * 0.8, label: '80% of the total' }] : undefined}
      tableColumns={['Cause', valueLabel, 'Share', 'Running share']}
      tableRow={(index) => [rows[index]?.label ?? '', fmt.value(rows[index]?.value ?? 0), share(rows[index]?.value ?? 0), share(cumulative[index] ?? 0)]}
      rovingStart="first"
    />
  );
}
