'use client';
/**
 * The cartesian engine behind LineChart, AreaChart, vertical BarChart, ComboChart, WaterfallChart
 * and ParetoChart: one x axis of categories or dates, bars and lines on a value axis, a hover band
 * or crosshair, one tooltip that lists every series, and arrow key movement between points.
 * Callers use the named charts in `cartesian.tsx`; this file is the shared drawing code.
 */
import type { PointerEvent } from 'react';
import { CHART_COLORS, type ChartFormatter } from './chart-format';
import { ChartFrame, ChartLive, ChartTooltip, KEY_HINT, SvgLabels, tooltipText, useRoving, type ChartBaseProps, type ChartTableModel, type LegendItem, type TooltipModel, type TooltipRow } from './frame';
import { areaPath, bandLayout, barPath, clamp, estimateTextWidth, fitLabel, labelStride, wrapLabel, linePath, linearScale, niceScale, pointPositions, visibleLabelIndexes, type NiceScale } from './scale';

export interface XYCategory {
  readonly key: string;
  /** Short text under the axis. */
  readonly label: string;
  /** Full text for the tooltip and the table. */
  readonly long: string;
}

export interface XYSeries {
  readonly id: string;
  readonly label: string;
  readonly values: readonly (number | null)[];
  /** Words for a gap at that position ("Not known"). Left out, a gap reads "No data". */
  readonly gapText?: readonly (string | null)[];
  readonly color: string;
  /** Lines only: draw it dashed, for a forecast or a plan next to the real line. Never filled as an area. */
  readonly dashed?: boolean;
}

/** What a gap reads at one position: the series' own words, else "No data". */
const gapWords = (series: Pick<XYSeries, 'gapText'>, index: number): string => series.gapText?.[index] ?? 'No data';

export interface XYFloat {
  readonly from: number;
  readonly to: number;
  readonly color: string;
  readonly kind: 'total' | 'up' | 'down' | 'flat';
  /** Text above the bar and in the tooltip ("+$1,200"). */
  readonly text: string;
  readonly longText: string;
}

export interface XYTarget {
  readonly value: number;
  readonly label: string;
  /** Which scale the target lives on when lines have their own. */
  readonly on?: 'bars' | 'lines';
}

export interface XYProps extends ChartBaseProps {
  readonly categories: readonly XYCategory[];
  /** `true` when the x axis is time: labels may be skipped. Categories get slanted or cut instead. */
  readonly timeAxis?: boolean;
  readonly bars?: readonly XYSeries[];
  readonly barMode?: 'grouped' | 'stacked';
  /** One bar series only: bars under zero take the "down" color. */
  readonly signColors?: boolean;
  readonly floats?: readonly XYFloat[];
  readonly lines?: readonly XYSeries[];
  readonly area?: boolean;
  /** `own`: lines get their own scale (combo). `shared`: lines read the bar scale. */
  readonly lineScale?: 'shared' | 'own';
  /** With `own`: `split` stacks two panels on one x axis (the honest default), `overlay` draws a right axis. */
  readonly layout?: 'split' | 'overlay';
  readonly format: ChartFormatter;
  readonly lineFormat?: ChartFormatter;
  readonly target?: XYTarget;
  readonly showValues?: boolean;
  /** Lines only: start the value axis at zero. Bars always do. */
  readonly zeroBased?: boolean;
  /** Force the main domain (Pareto uses 0 to the total). */
  readonly domain?: readonly [number, number];
  /** With `domain`: exact tick values (Pareto lines both axes up on shares of the total). */
  readonly ticks?: readonly number[];
  readonly rightTicks?: readonly { value: number; label: string }[];
  readonly referenceLines?: readonly { value: number; label: string }[];
  readonly extraRows?: (index: number) => readonly TooltipRow[];
  readonly legendExtra?: readonly LegendItem[];
  readonly tableColumns?: readonly string[];
  readonly tableRow?: (index: number) => readonly string[];
  readonly rovingStart?: 'first' | 'last';
}

const FONT = 11;
const AXIS_TEXT = 'var(--text-muted)';

interface Region {
  readonly top: number;
  readonly bottom: number;
  readonly scale: NiceScale;
  readonly y: (value: number) => number;
  readonly format: ChartFormatter;
}

function region(top: number, bottom: number, scale: NiceScale, format: ChartFormatter): Region {
  return { top, bottom, scale, y: linearScale(scale.min, scale.max, bottom, top), format };
}

function stackExtents(series: readonly XYSeries[], count: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    let up = 0;
    let down = 0;
    for (const item of series) {
      const value = item.values[index] ?? 0;
      if (value >= 0) up += value;
      else down += value;
    }
    out.push(up, down);
  }
  return out;
}

export function XYChart(props: XYProps) {
  const { categories, bars = [], lines = [], floats, format, target } = props;
  const count = categories.length;
  const hasBars = bars.length > 0 || Boolean(floats);
  const hasAny = [...bars, ...lines].some((series) => series.values.some((value) => value !== null && value !== undefined)) || Boolean(floats && floats.length > 0);
  const empty = count === 0 || !hasAny;
  const lineFormat = props.lineFormat ?? format;
  const ownLines = props.lineScale === 'own' && lines.length > 0 && hasBars;
  const stacked = props.barMode === 'stacked' && bars.length > 1;

  const legend: LegendItem[] = [];
  if (!floats && bars.length + lines.length > 1) {
    for (const series of bars) legend.push({ id: series.id, label: series.label, color: series.color, shape: 'box' });
    for (const series of lines) legend.push({ id: series.id, label: series.label, color: series.color, shape: series.dashed ? 'dash' : 'line' });
  }
  if (props.signColors && bars.length === 1 && bars[0]!.values.some((value) => (value ?? 0) < 0)) {
    legend.push({ id: 'above', label: 'Above zero', color: bars[0]!.color, shape: 'box' }, { id: 'below', label: 'Below zero', color: CHART_COLORS.down, shape: 'box' });
  }
  if (target && legend.length > 0) legend.push({ id: 'target', label: target.label, color: 'var(--text-secondary)', shape: 'dash' });
  if (props.legendExtra) legend.push(...props.legendExtra);

  const all = [...bars.map((series) => ({ series, fmt: format })), ...lines.map((series) => ({ series, fmt: lineFormat }))];
  const table: ChartTableModel =
    props.tableColumns && props.tableRow
      ? { columns: props.tableColumns, rows: categories.map((_, index) => props.tableRow!(index)) }
      : {
          columns: ['', ...all.map((item) => item.series.label)],
          rows: categories.map((category, index) => [
            category.long,
            ...all.map((item) => {
              const value = item.series.values[index];
              return value === null || value === undefined ? gapWords(item.series, index) : item.fmt.value(value);
            }),
          ]),
        };

  return (
    <ChartFrame {...props} empty={empty} legend={legend} table={table} defaultHeight={ownLines && props.layout !== 'overlay' ? 320 : 260}>
      {({ width, height, titleId, descId }) => <Plot {...props} width={width} height={height} titleId={titleId} descId={descId} ownLines={ownLines} stacked={stacked} hasBars={hasBars} lineFormat={lineFormat} />}
    </ChartFrame>
  );
}

interface PlotProps extends XYProps {
  readonly width: number;
  readonly height: number;
  readonly titleId: string;
  readonly descId: string;
  readonly ownLines: boolean;
  readonly stacked: boolean;
  readonly hasBars: boolean;
  readonly lineFormat: ChartFormatter;
}

function Plot(props: PlotProps) {
  const { categories, bars = [], lines = [], floats, format, lineFormat, target, width, height, ownLines, stacked, hasBars } = props;
  const count = categories.length;
  const split = ownLines && props.layout !== 'overlay';
  const overlay = ownLines && !split;
  const roving = useRoving(count, { start: props.rovingStart ?? (props.timeAxis ? 'last' : 'first') });

  // --- value domains ---
  const barValues: number[] = [];
  if (floats) for (const item of floats) barValues.push(item.from, item.to);
  if (stacked) barValues.push(...stackExtents(bars, count));
  else for (const series of bars) for (const value of series.values) if (value !== null && value !== undefined) barValues.push(value);
  const lineValues: number[] = [];
  for (const series of lines) for (const value of series.values) if (value !== null && value !== undefined) lineValues.push(value);
  for (const ref of props.referenceLines ?? []) (ownLines ? lineValues : barValues).push(ref.value);
  if (target) (ownLines && target.on === 'lines' ? lineValues : hasBars ? barValues : lineValues).push(target.value);

  const mainValues = ownLines ? barValues : [...barValues, ...lineValues];
  const valueLabelRoom = props.showValues || floats ? 16 : 0;
  const hasNegative = mainValues.some((value) => value < 0);

  // --- x labels: decide slant before the plot height is known ---
  const labels = categories.map((category) => category.label);
  const left0 = 44;
  const roughSlot = Math.max(1, (width - left0 - 12) / Math.max(1, count));
  const widest = labels.length ? Math.max(...labels.map((label) => estimateTextWidth(label, FONT))) : 0;
  const crowded = !props.timeAxis && hasBars && count > 1 && widest + 8 > roughSlot;
  const wrap = crowded && roughSlot >= 54;
  const slant = crowded && !wrap;
  const slantMax = 92;
  const bottomPad = slant ? Math.min(slantMax, widest) * 0.58 + 22 : wrap ? 38 : 24;
  const topPad = 8 + valueLabelRoom;
  const plotTop = topPad;
  const plotBottom = Math.max(plotTop + 40, height - bottomPad);

  // --- regions ---
  const lineShare = split ? Math.round((plotBottom - plotTop) * 0.34) : 0;
  const mainTop = split ? plotTop + lineShare + 28 : plotTop;
  const mainTicks = Math.max(2, Math.min(6, Math.floor((plotBottom - mainTop) / 40)));
  const includeZeroMain = hasBars || props.area || (props.zeroBased ?? false);
  const mainScale: NiceScale = props.domain
    ? { min: props.domain[0], max: props.domain[1], step: (props.domain[1] - props.domain[0]) / mainTicks, ticks: props.ticks ?? niceScale([props.domain[0], props.domain[1]], { tickCount: mainTicks }).ticks.filter((tick) => tick <= props.domain![1]) }
    : niceScale(mainValues, { tickCount: mainTicks, includeZero: includeZeroMain });
  const main = region(mainTop, plotBottom, mainScale, hasBars ? format : lineFormat);
  const second: Region | null = ownLines
    ? region(plotTop, split ? plotTop + lineShare : plotBottom, niceScale(lineValues, { tickCount: split ? 2 : mainTicks, includeZero: props.zeroBased ?? false }), lineFormat)
    : null;
  const lineRegion = second ?? main;

  // --- gutters ---
  const leftLabels = [...main.scale.ticks.map((tick) => main.format.axis(tick)), ...(split && second ? second.scale.ticks.map((tick) => second.format.axis(tick)) : [])];
  const left = Math.ceil(Math.max(24, ...leftLabels.map((label) => estimateTextWidth(label, FONT))) + 10);
  const rightLabels = overlay && second ? second.scale.ticks.map((tick) => second.format.axis(tick)) : (props.rightTicks?.map((tick) => tick.label) ?? []);
  const right = rightLabels.length ? width - Math.ceil(Math.max(...rightLabels.map((label) => estimateTextWidth(label, FONT))) + 10) : width - 10;

  // --- x positions ---
  const band = bandLayout(count, left, right, { maxBand: 24 });
  const xs = hasBars ? categories.map((_, index) => band.center(index)) : pointPositions(count, left + 6, right - 6);
  const slot = hasBars ? band.step : count > 1 ? (right - left - 12) / (count - 1) : right - left;

  const stride = wrap ? 1 : slant ? Math.max(1, Math.ceil(16 / Math.max(1, slot))) : labelStride(labels, slot, props.timeAxis ? {} : { maxLabelWidth: Math.max(36, slot - 12) });
  const shown = visibleLabelIndexes(count, stride);
  const labelMax = slant ? slantMax : props.timeAxis ? Number.POSITIVE_INFINITY : Math.max(36, slot * stride - 10);

  // --- bars ---
  const groupCount = stacked || floats ? 1 : Math.max(1, bars.length);
  const barWidth = clamp((band.step * 0.72 - (groupCount - 1) * 2) / groupCount, 2, 24);
  const groupWidth = groupCount * barWidth + (groupCount - 1) * 2;
  const zeroY = main.y(clamp(0, main.scale.min, main.scale.max));

  // Value labels are all or nothing: a chart with a label on some bars and not on others reads as broken.
  const fitsAll = (texts: readonly string[]): boolean => texts.every((text) => estimateTextWidth(text, FONT) + 6 <= band.step);
  const stackTotals = stacked ? categories.map((_, index) => bars.reduce((sum, series) => sum + (series.values[index] ?? 0), 0)) : [];
  const showStackValues = Boolean(props.showValues) && stacked && fitsAll(stackTotals.map((value) => format.axis(value)));
  const showBarValues = Boolean(props.showValues) && !stacked && bars.length === 1 && fitsAll((bars[0]?.values ?? []).map((value) => (value === null || value === undefined ? '' : format.axis(value))));
  const showFloatValues = floats ? fitsAll(floats.map((item) => item.text)) : false;

  const active = roving.active;
  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box || count === 0) return;
    const x = event.clientX - box.left;
    let index: number;
    if (hasBars) index = clamp(Math.floor((x - left) / Math.max(1, band.step)), 0, count - 1);
    else {
      index = 0;
      let best = Number.POSITIVE_INFINITY;
      xs.forEach((value, i) => {
        const distance = Math.abs(value - x);
        if (distance < best) {
          best = distance;
          index = i;
        }
      });
    }
    if (index !== active) roving.hover(index);
  };

  // --- tooltip ---
  let tooltip: TooltipModel | null = null;
  if (active !== null) {
    const rows: TooltipRow[] = [];
    let top = plotBottom;
    if (floats) {
      const item = floats[active];
      if (item) {
        rows.push({ id: 'float', label: item.kind === 'total' ? 'Total' : item.kind === 'up' ? 'Adds' : item.kind === 'down' ? 'Takes away' : 'No change', value: item.longText, color: item.color, shape: 'box' });
        top = Math.min(top, main.y(Math.max(item.from, item.to)));
      }
    }
    let total = 0;
    let stackTop = 0;
    for (const series of bars) {
      const value = series.values[active];
      const color = props.signColors && bars.length === 1 && (value ?? 0) < 0 ? CHART_COLORS.down : series.color;
      rows.push({ id: series.id, label: series.label, value: value === null || value === undefined ? gapWords(series, active) : format.value(value), color, shape: 'box' });
      if (value !== null && value !== undefined) {
        total += value;
        if (value > 0) stackTop += value;
        top = Math.min(top, main.y(stacked ? stackTop : Math.max(0, value)));
      }
    }
    if (stacked) rows.push({ id: 'total', label: 'Total', value: format.value(total), muted: true });
    for (const series of lines) {
      const value = series.values[active];
      rows.push({ id: series.id, label: series.label, value: value === null || value === undefined ? gapWords(series, active) : lineFormat.value(value), color: series.color, shape: 'line' });
      if (value !== null && value !== undefined) top = Math.min(top, lineRegion.y(value));
    }
    if (target) rows.push({ id: 'target', label: target.label, value: (ownLines && target.on === 'lines' ? lineFormat : hasBars ? format : lineFormat).value(target.value), color: 'var(--text-secondary)', shape: 'dash', muted: true });
    if (props.extraRows) rows.push(...props.extraRows(active));
    tooltip = { x: xs[active] ?? 0, y: top, title: categories[active]?.long ?? '', rows };
  }

  const gridRegion = (reg: Region, key: string, drawLabels: 'left' | 'right' | 'none') =>
    reg.scale.ticks.map((tick) => {
      const y = reg.y(tick);
      const isZero = tick === 0 && (reg.scale.min < 0 || hasBars || props.area);
      return (
        <g key={`${key}-${tick}`}>
          {drawLabels !== 'right' ? <line x1={left} x2={right} y1={y} y2={y} stroke={isZero ? CHART_COLORS.axis : CHART_COLORS.grid} strokeWidth={1} shapeRendering="crispEdges" /> : null}
          {drawLabels === 'left' ? (
            <text x={left - 8} y={y} dy="0.32em" textAnchor="end" fontSize={FONT} fill={AXIS_TEXT}>
              {reg.format.axis(tick)}
            </text>
          ) : drawLabels === 'right' ? (
            <text x={right + 8} y={y} dy="0.32em" textAnchor="start" fontSize={FONT} fill={AXIS_TEXT}>
              {reg.format.axis(tick)}
            </text>
          ) : null}
        </g>
      );
    });

  const targetRegion = target ? (ownLines && target.on === 'lines' ? lineRegion : main) : null;
  const targetY = target && targetRegion ? targetRegion.y(target.value) : 0;
  const targetText = target && targetRegion ? `${target.label} ${targetRegion.format.axis(target.value)}` : '';
  // Where the target label sits: the corner near the dashed line where no data line passes, so the
  // words never cover the marks (right above, right below, left above, left below, in that order).
  const targetLabel = (() => {
    const fallback = { x: right - 4, y: targetRegion && targetY - targetRegion.top < 18 ? targetY + 14 : targetY - 6, anchor: 'end' as const };
    if (!target || !targetRegion || targetRegion !== lineRegion || lines.length === 0) return fallback;
    const labelWidth = targetText.length * 6.4 + 8;
    const count = categories.length;
    const hits = (fromX: number, toX: number, fromY: number, toY: number): number => {
      let total = 0;
      for (const series of lines) {
        for (let index = 0; index < count; index += 1) {
          const value = series.values[index];
          if (value === null || value === undefined) continue;
          const x = xs[index] ?? 0;
          const y = lineRegion.y(value);
          const next = series.values[index + 1];
          // The point itself, plus the middle of the stroke to the next point.
          const samples: [number, number][] = [[x, y]];
          if (next !== null && next !== undefined && index + 1 < count) {
            const nx = xs[index + 1] ?? 0;
            const ny = lineRegion.y(next);
            for (const t of [0.25, 0.5, 0.75]) samples.push([x + (nx - x) * t, y + (ny - y) * t]);
          }
          for (const [sx, sy] of samples) if (sx >= fromX && sx <= toX && sy >= fromY && sy <= toY) total += 1;
        }
      }
      return total;
    };
    const roomAbove = targetY - targetRegion.top >= 18;
    const roomBelow = targetRegion.bottom - targetY >= 18;
    const candidates = [
      ...(roomAbove ? [{ x: right - 4, y: targetY - 6, anchor: 'end' as const, score: hits(right - labelWidth - 6, right + 6, targetY - 20, targetY - 1) }] : []),
      ...(roomBelow ? [{ x: right - 4, y: targetY + 14, anchor: 'end' as const, score: hits(right - labelWidth - 6, right + 6, targetY + 1, targetY + 20) }] : []),
      ...(roomAbove ? [{ x: left + 4, y: targetY - 6, anchor: 'start' as const, score: hits(left - 6, left + labelWidth + 6, targetY - 20, targetY - 1) }] : []),
      ...(roomBelow ? [{ x: left + 4, y: targetY + 14, anchor: 'start' as const, score: hits(left - 6, left + labelWidth + 6, targetY + 1, targetY + 20) }] : []),
    ];
    let best: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) if (!best || candidate.score < best.score) best = candidate;
    return best ?? fallback;
  })();

  return (
    <>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-roledescription="chart"
        aria-labelledby={`${props.titleId}-svg`}
        aria-describedby={`${props.descId}-svg`}
        tabIndex={0}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
        onBlur={roving.onBlur}
        className="block touch-pan-y overflow-visible"
      >
        <SvgLabels titleId={props.titleId} descId={props.descId} title={props.title} description={props.description} hint={KEY_HINT} />

        {/* hover band behind the marks */}
        {active !== null && hasBars ? <rect x={(xs[active] ?? 0) - band.step / 2} y={plotTop - valueLabelRoom} width={band.step} height={plotBottom - plotTop + valueLabelRoom} fill="var(--surface-hover)" rx={4} /> : null}

        {gridRegion(main, 'main', 'left')}
        {second ? gridRegion(second, 'second', split ? 'left' : 'right') : null}
        {props.rightTicks?.map((tick) => (
          <text key={`rt-${tick.value}`} x={right + 8} y={main.y(tick.value)} dy="0.32em" textAnchor="start" fontSize={FONT} fill={AXIS_TEXT}>
            {tick.label}
          </text>
        ))}
        {split && second ? <line x1={left} x2={right} y1={second.bottom} y2={second.bottom} stroke={CHART_COLORS.axis} strokeWidth={1} shapeRendering="crispEdges" /> : null}

        {props.referenceLines?.map((ref) => {
          const y = lineRegion.y(ref.value);
          return (
            <g key={`ref-${ref.value}`}>
              <line x1={left} x2={right} y1={y} y2={y} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 3" />
              <text x={left + 4} y={y - 5} fontSize={FONT} fill="var(--text-secondary)" stroke="var(--surface-panel)" strokeWidth={3} paintOrder="stroke">
                {ref.label}
              </text>
            </g>
          );
        })}

        {/* bars */}
        {floats
          ? floats.map((item, index) => {
              const x = (xs[index] ?? 0) - barWidth / 2;
              const from = main.y(item.from);
              let to = main.y(item.to);
              if (item.from !== item.to && Math.abs(to - from) < 2) to = from + (to < from ? -2 : 2);
              const next = floats[index + 1];
              const labelY = Math.min(from, to) - 5;
              return (
                <g key={categories[index]?.key ?? index}>
                  {next ? <line x1={x + barWidth} x2={(xs[index + 1] ?? 0) - barWidth / 2} y1={main.y(item.to)} y2={main.y(item.to)} stroke={CHART_COLORS.axis} strokeWidth={1} shapeRendering="crispEdges" /> : null}
                  {item.from === item.to ? (
                    <line x1={x} x2={x + barWidth} y1={from} y2={from} stroke={item.color} strokeWidth={2} />
                  ) : (
                    <path className="pc-mark" d={barPath(x, barWidth, from, to, 4)} fill={item.color} />
                  )}
                  {showFloatValues ? (
                    <text x={xs[index]} y={labelY} textAnchor="middle" fontSize={FONT} fontWeight={item.kind === 'total' ? 600 : 500} fill="var(--text-primary)" stroke="var(--surface-panel)" strokeWidth={3} paintOrder="stroke">
                      {item.text}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}
        {!floats && stacked
          ? categories.map((category, index) => {
              let up = 0;
              let down = 0;
              const lastUp = bars.reduce((last, series, i) => ((series.values[index] ?? 0) > 0 ? i : last), -1);
              const lastDown = bars.reduce((last, series, i) => ((series.values[index] ?? 0) < 0 ? i : last), -1);
              const x = (xs[index] ?? 0) - barWidth / 2;
              return (
                <g key={category.key}>
                  {bars.map((series, i) => {
                    const value = series.values[index] ?? 0;
                    if (value === 0) return null;
                    const start = value > 0 ? up : down;
                    const end = start + value;
                    if (value > 0) up = end;
                    else down = end;
                    let from = main.y(start);
                    const to = main.y(end);
                    const gap = start !== 0 && Math.abs(to - from) > 3 ? 2 : 0;
                    from += value > 0 ? -gap : gap;
                    const outer = value > 0 ? i === lastUp : i === lastDown;
                    return <path key={series.id} className="pc-mark" d={barPath(x, barWidth, from, to, outer ? 4 : 0)} fill={series.color} />;
                  })}
                  {showStackValues ? (
                    <text x={xs[index]} y={main.y(up) - 5} textAnchor="middle" fontSize={FONT} fontWeight={500} fill="var(--text-primary)" stroke="var(--surface-panel)" strokeWidth={3} paintOrder="stroke">
                      {format.axis(up + down)}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}
        {!floats && !stacked
          ? bars.map((series, s) =>
              series.values.map((value, index) => {
                if (value === null || value === undefined || index >= count) return null;
                const x = (xs[index] ?? 0) - groupWidth / 2 + s * (barWidth + 2);
                const color = props.signColors && bars.length === 1 && value < 0 ? CHART_COLORS.down : series.color;
                let to = main.y(value);
                if (value !== 0 && Math.abs(to - zeroY) < 2) to = zeroY + (value > 0 ? -2 : 2);
                const text = format.axis(value);
                return (
                  <g key={`${series.id}-${index}`}>
                    {value === 0 ? <line x1={x} x2={x + barWidth} y1={zeroY} y2={zeroY} stroke={color} strokeWidth={2} /> : <path className="pc-mark" d={barPath(x, barWidth, zeroY, to, 4)} fill={color} />}
                    {showBarValues ? (
                      <text x={x + barWidth / 2} y={value < 0 ? to + 13 : to - 5} textAnchor="middle" fontSize={FONT} fontWeight={500} fill="var(--text-primary)" stroke="var(--surface-panel)" strokeWidth={3} paintOrder="stroke">
                        {text}
                      </text>
                    ) : null}
                  </g>
                );
              }),
            )
          : null}

        {/* lines */}
        {lines.map((series) => {
          const ys = series.values.slice(0, count).map((value) => (value === null || value === undefined ? null : lineRegion.y(value)));
          const baseline = lineRegion.y(clamp(0, lineRegion.scale.min, lineRegion.scale.max));
          let lastIndex = -1;
          ys.forEach((y, index) => {
            if (y !== null) lastIndex = index;
          });
          return (
            <g key={series.id}>
              {props.area && !series.dashed ? <path d={areaPath(xs, ys, baseline)} fill={series.color} fillOpacity={0.12} /> : null}
              <path d={linePath(xs, ys)} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={series.dashed ? '6 5' : undefined} />
              {ys.map((y, index) => {
                if (y === null) return null;
                const alone = (ys[index - 1] ?? null) === null && (ys[index + 1] ?? null) === null;
                const dense = count > 24;
                if (!alone && index !== lastIndex && (dense || !hasBars)) return null;
                return <circle key={index} cx={xs[index]} cy={y} r={alone || index === lastIndex ? 4 : 3} fill={series.color} stroke="var(--surface-panel)" strokeWidth={2} />;
              })}
            </g>
          );
        })}

        {/* target */}
        {target && targetRegion ? (
          <g>
            <line x1={left} x2={right} y1={targetY} y2={targetY} stroke="var(--text-secondary)" strokeWidth={1.5} strokeDasharray="5 4" />
            <text
              x={targetLabel.x}
              y={targetLabel.y}
              textAnchor={targetLabel.anchor}
              fontSize={FONT}
              fontWeight={500}
              fill="var(--text-secondary)"
              stroke="var(--surface-panel)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {targetText}
            </text>
          </g>
        ) : null}

        {/* x labels */}
        {categories.map((category, index) => {
          if (!shown.has(index)) return null;
          const x = xs[index] ?? 0;
          if (wrap) {
            const lines = wrapLabel(category.label, slot - 8, FONT);
            return (
              <text key={category.key} textAnchor="middle" fontSize={FONT} fill={active === index ? 'var(--text-primary)' : AXIS_TEXT}>
                {lines.map((line, lineIndex) => (
                  <tspan key={lineIndex} x={x} y={plotBottom + 16 + lineIndex * 13}>
                    {line}
                  </tspan>
                ))}
              </text>
            );
          }
          const text = fitLabel(category.label, labelMax, FONT);
          if (!text) return null;
          if (slant) {
            // A slanted label runs down and to the left: keep it inside the chart's left edge.
            const slanted = fitLabel(category.label, Math.min(slantMax, (x + 10) / 0.82), FONT);
            if (!slanted) return null;
            return (
              <text key={category.key} transform={`translate(${x + 3} ${plotBottom + 12}) rotate(-35)`} textAnchor="end" fontSize={FONT} fill={AXIS_TEXT}>
                {slanted}
              </text>
            );
          }
          const half = estimateTextWidth(text, FONT) / 2;
          const cx = clamp(x, half, Math.max(half, width - half));
          return (
            <text key={category.key} x={cx} y={plotBottom + 16} textAnchor="middle" fontSize={FONT} fill={active === index ? 'var(--text-primary)' : AXIS_TEXT}>
              {text}
            </text>
          );
        })}

        {/* crosshair and active points */}
        {active !== null ? (
          <g pointerEvents="none">
            {!hasBars || lines.length > 0 ? <line x1={xs[active]} x2={xs[active]} y1={plotTop} y2={plotBottom} stroke={CHART_COLORS.axis} strokeWidth={1} shapeRendering="crispEdges" /> : null}
            {lines.map((series) => {
              const value = series.values[active];
              if (value === null || value === undefined) return null;
              return <circle key={series.id} cx={xs[active]} cy={lineRegion.y(value)} r={4.5} fill={series.color} stroke="var(--surface-panel)" strokeWidth={2} />;
            })}
            {roving.byKeyboard && hasBars ? <rect x={(xs[active] ?? 0) - band.step / 2 + 1} y={plotTop - valueLabelRoom + 1} width={Math.max(0, band.step - 2)} height={plotBottom - plotTop + valueLabelRoom - 2} fill="none" stroke="var(--focus-ring)" strokeWidth={1.5} rx={4} /> : null}
          </g>
        ) : null}

        <rect x={0} y={0} width={width} height={height} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => roving.hover(null)} />
      </svg>
      <ChartTooltip model={tooltip} boxWidth={width} />
      <ChartLive text={roving.byKeyboard ? tooltipText(tooltip) : ''} />
      {hasNegative ? <span className="sr-only">Some values are below zero.</span> : null}
    </>
  );
}
