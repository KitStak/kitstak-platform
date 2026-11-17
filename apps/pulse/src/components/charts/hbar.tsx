'use client';
/**
 * Horizontal bars: rankings and long names. Names sit on the left (cut with three dots when the
 * card is narrow, full text in the tooltip and table), values print at the bar ends, and bars
 * under zero grow to the left of the zero line. Grouped and stacked work the same as vertical.
 */
import type { PointerEvent } from 'react';
import { CHART_COLORS, type ChartFormatter } from './chart-format';
import { ChartFrame, ChartLive, ChartTooltip, KEY_HINT, SvgLabels, tooltipText, useRoving, type ChartBaseProps, type LegendItem, type TooltipModel, type TooltipRow } from './frame';
import { barPath, clamp, estimateTextWidth, fitLabel, linearScale, niceScale } from './scale';
import type { XYCategory, XYSeries, XYTarget } from './xy';

export interface HorizontalBarsProps extends ChartBaseProps {
  readonly categories: readonly XYCategory[];
  readonly series: readonly XYSeries[];
  readonly mode: 'grouped' | 'stacked';
  readonly format: ChartFormatter;
  readonly target?: XYTarget;
  readonly showValues?: boolean;
  readonly signColors?: boolean;
}

const FONT = 11;
const LABEL_FONT = 12;

export function HorizontalBars(props: HorizontalBarsProps) {
  const { categories, series, mode, format, target } = props;
  const stacked = mode === 'stacked' && series.length > 1;
  const grouped = !stacked && series.length > 1;
  const barThickness = grouped ? 10 : 16;
  const rowHeight = grouped ? series.length * barThickness + (series.length - 1) * 2 + 16 : 32;
  const axisBand = 24;
  const topPad = target ? 18 : 4;
  const empty = categories.length === 0 || !series.some((item) => item.values.some((value) => value !== null && value !== undefined));
  const naturalHeight = topPad + categories.length * rowHeight + axisBand;

  const legend: LegendItem[] = [];
  if (series.length > 1) for (const item of series) legend.push({ id: item.id, label: item.label, color: item.color, shape: 'box' });
  if (props.signColors && series.length === 1 && series[0]!.values.some((value) => (value ?? 0) < 0)) {
    legend.push({ id: 'above', label: 'Above zero', color: series[0]!.color, shape: 'box' }, { id: 'below', label: 'Below zero', color: CHART_COLORS.down, shape: 'box' });
  }
  if (target && legend.length > 0) legend.push({ id: 'target', label: target.label, color: 'var(--text-secondary)', shape: 'dash' });

  const table = {
    columns: ['', ...series.map((item) => item.label), ...(stacked ? ['Total'] : [])],
    rows: categories.map((category, index) => {
      const cells = series.map((item) => {
        const value = item.values[index];
        return value === null || value === undefined ? 'No data' : format.value(value);
      });
      return [category.long, ...cells, ...(stacked ? [format.value(series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0))] : [])];
    }),
  };

  return (
    <ChartFrame {...props} height={empty || props.loading || props.error ? (props.height ?? 200) : naturalHeight} empty={empty} legend={legend} table={table} defaultHeight={naturalHeight}>
      {({ width, height, titleId, descId }) => (
        <Rows {...props} width={width} height={height} titleId={titleId} descId={descId} stacked={stacked} grouped={grouped} rowHeight={rowHeight} barThickness={barThickness} topPad={topPad} axisBand={axisBand} />
      )}
    </ChartFrame>
  );
}

interface RowsProps extends HorizontalBarsProps {
  readonly width: number;
  readonly height: number;
  readonly titleId: string;
  readonly descId: string;
  readonly stacked: boolean;
  readonly grouped: boolean;
  readonly rowHeight: number;
  readonly barThickness: number;
  readonly topPad: number;
  readonly axisBand: number;
}

function Rows(props: RowsProps) {
  const { categories, series, format, target, width, height, stacked, grouped, rowHeight, barThickness, topPad, axisBand } = props;
  const count = categories.length;
  const roving = useRoving(count, { start: 'first' });
  const showValues = (props.showValues ?? true) && !grouped;

  const totals = categories.map((_, index) => series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0));
  const extents: number[] = [];
  categories.forEach((_, index) => {
    if (stacked) {
      let up = 0;
      let down = 0;
      for (const item of series) {
        const value = item.values[index] ?? 0;
        if (value >= 0) up += value;
        else down += value;
      }
      extents.push(up, down);
    } else for (const item of series) extents.push(item.values[index] ?? 0);
  });
  if (target) extents.push(target.value);

  const labelColumn = Math.ceil(Math.min(Math.max(...categories.map((category) => estimateTextWidth(category.label, LABEL_FONT)), 24), clamp(width * 0.34, 72, 200)));
  const valueTexts = showValues ? categories.map((_, index) => format.axis(stacked ? totals[index]! : (series[0]?.values[index] ?? 0))) : [];
  const valueRoom = showValues ? Math.ceil(Math.max(0, ...valueTexts.map((text) => estimateTextWidth(text, FONT))) + 8) : 8;
  const hasNegative = extents.some((value) => value < 0);
  const left = labelColumn + 12 + (hasNegative && showValues ? valueRoom : 0);
  const right = Math.max(left + 40, width - valueRoom - 2);
  const scale = niceScale(extents, { tickCount: clamp(Math.floor((right - left) / 72), 2, 6) });
  const x = linearScale(scale.min, scale.max, left, right);
  const zeroX = x(0);
  const plotBottom = height - axisBand;
  const rowTop = (index: number): number => topPad + index * rowHeight;

  const active = roving.active;
  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box || count === 0) return;
    const index = clamp(Math.floor((event.clientY - box.top - topPad) / rowHeight), 0, count - 1);
    if (index !== active) roving.hover(index);
  };

  let tooltip: TooltipModel | null = null;
  if (active !== null) {
    const rows: TooltipRow[] = series.map((item) => {
      const value = item.values[active];
      const color = props.signColors && series.length === 1 && (value ?? 0) < 0 ? CHART_COLORS.down : item.color;
      return { id: item.id, label: item.label, value: value === null || value === undefined ? 'No data' : format.value(value), color, shape: 'box' as const };
    });
    if (stacked) rows.push({ id: 'total', label: 'Total', value: format.value(totals[active] ?? 0), muted: true });
    if (target) rows.push({ id: 'target', label: target.label, value: format.value(target.value), color: 'var(--text-secondary)', shape: 'dash', muted: true });
    tooltip = { x: clamp(x(Math.max(0, totals[active] ?? 0)), left, right), y: rowTop(active) + rowHeight - 4, title: categories[active]?.long ?? '', rows };
  }

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
        {active !== null ? <rect x={0} y={rowTop(active)} width={width} height={rowHeight} fill="var(--surface-hover)" rx={4} /> : null}
        {scale.ticks.map((tick) => {
          const tx = x(tick);
          const text = format.axis(tick);
          const half = estimateTextWidth(text, FONT) / 2;
          return (
            <g key={tick}>
              <line x1={tx} x2={tx} y1={topPad} y2={plotBottom} stroke={tick === 0 ? CHART_COLORS.axis : CHART_COLORS.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={clamp(tx, half, width - half)} y={plotBottom + 16} textAnchor="middle" fontSize={FONT} fill="var(--text-muted)">
                {text}
              </text>
            </g>
          );
        })}

        {categories.map((category, index) => {
          const top = rowTop(index);
          const mid = top + rowHeight / 2;
          let up = 0;
          let down = 0;
          const lastUp = series.reduce((last, item, i) => ((item.values[index] ?? 0) > 0 ? i : last), -1);
          const lastDown = series.reduce((last, item, i) => ((item.values[index] ?? 0) < 0 ? i : last), -1);
          const total = totals[index] ?? 0;
          const marks = series.map((item, s) => {
            const value = item.values[index];
            if (value === null || value === undefined) return null;
            const color = props.signColors && series.length === 1 && value < 0 ? CHART_COLORS.down : item.color;
            if (stacked) {
              if (value === 0) return null;
              const start = value > 0 ? up : down;
              const end = start + value;
              if (value > 0) up = end;
              else down = end;
              let from = x(start);
              const to = x(end);
              const gap = start !== 0 && Math.abs(to - from) > 3 ? 2 : 0;
              from += value > 0 ? gap : -gap;
              const outer = value > 0 ? s === lastUp : s === lastDown;
              return <path key={item.id} className="pc-mark" d={barPath(mid - barThickness / 2, barThickness, from, to, outer ? 4 : 0, false)} fill={color} />;
            }
            const y = grouped ? top + 8 + s * (barThickness + 2) : mid - barThickness / 2;
            if (value === 0) return <line key={item.id} x1={zeroX} x2={zeroX} y1={y} y2={y + barThickness} stroke={color} strokeWidth={2} />;
            let to = x(value);
            if (Math.abs(to - zeroX) < 2) to = zeroX + (value > 0 ? 2 : -2);
            return <path key={item.id} className="pc-mark" d={barPath(y, barThickness, zeroX, to, 4, false)} fill={color} />;
          });
          const labelValue = stacked ? total : (series[0]?.values[index] ?? null);
          const tip = stacked ? (total >= 0 ? x(up) : x(down)) : labelValue === null ? zeroX : x(labelValue);
          return (
            <g key={category.key}>
              <text x={0} y={mid} dy="0.34em" fontSize={LABEL_FONT} fill={active === index ? 'var(--text-primary)' : 'var(--text-secondary)'}>
                {fitLabel(category.label, labelColumn, LABEL_FONT)}
              </text>
              {marks}
              {showValues && labelValue !== null ? (
                <text x={(labelValue ?? 0) < 0 ? tip - 6 : tip + 6} y={mid} dy="0.34em" textAnchor={(labelValue ?? 0) < 0 ? 'end' : 'start'} fontSize={FONT} fontWeight={500} fill="var(--text-primary)">
                  {valueTexts[index]}
                </text>
              ) : null}
              {showValues && labelValue === null ? (
                <text x={zeroX + 6} y={mid} dy="0.34em" fontSize={FONT} fill="var(--text-muted)">
                  No data
                </text>
              ) : null}
            </g>
          );
        })}

        {target ? (
          <g>
            <line x1={x(target.value)} x2={x(target.value)} y1={topPad - 4} y2={plotBottom} stroke="var(--text-secondary)" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={clamp(x(target.value), 40, width - 40)} y={topPad - 8} textAnchor="middle" fontSize={FONT} fontWeight={500} fill="var(--text-secondary)">
              {`${target.label} ${format.axis(target.value)}`}
            </text>
          </g>
        ) : null}

        {active !== null && roving.byKeyboard ? <rect x={1} y={rowTop(active) + 1} width={width - 2} height={rowHeight - 2} fill="none" stroke="var(--focus-ring)" strokeWidth={1.5} rx={4} pointerEvents="none" /> : null}
        <rect x={0} y={topPad} width={width} height={Math.max(0, count * rowHeight)} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => roving.hover(null)} />
      </svg>
      <ChartTooltip model={tooltip} boxWidth={width} />
      <ChartLive text={roving.byKeyboard ? tooltipText(tooltip) : ''} />
    </>
  );
}
