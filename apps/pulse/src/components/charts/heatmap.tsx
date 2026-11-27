'use client';
/**
 * HeatmapCalendar: one cell for each day. Weeks run left to right on wide cards and top to bottom
 * on narrow ones. Amounts that only go up use one hue from light to strong; amounts that can go
 * under zero (daily profit) use two hues around a quiet middle. Days with no data stay hollow so
 * they never read as zero.
 */
import type { PointerEvent } from 'react';
import { resolveFormat, type ChartFormat } from './chart-format';
import { ChartFrame, ChartLive, ChartTooltip, SvgLabels, tooltipText, useRoving, type ChartBaseProps, type TooltipModel } from './frame';
import { MONTH_NAMES_SHORT, WEEKDAY_NAMES_SHORT, clamp, formatDateLong, shiftDate, weekdayOf } from './scale';

export interface HeatmapDay {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `null` means nothing was logged that day. */
  readonly value: number | null;
}

export interface HeatmapCalendarProps extends Omit<ChartBaseProps, 'height'> {
  readonly days: readonly HeatmapDay[];
  readonly format?: ChartFormat;
  /** Name of the number in the tooltip and table: "Profit". */
  readonly valueLabel?: string;
  /** First day of the week, 0 = Sunday. Default 1 (Monday). */
  readonly weekStart?: number;
  /** `auto` picks two hues when any day is under zero. */
  readonly scale?: 'auto' | 'sequential' | 'diverging';
  /** Words at the ends of the color key. */
  readonly lowLabel?: string;
  readonly highLabel?: string;
}

const HUE = 'var(--pulse-series-1)';
const WARM = 'var(--pulse-chart-warm)';
const STEPS = [22, 44, 70, 100];

function mix(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, var(--surface-panel))`;
}

/** The fill for a value: step 0 is the quiet track, steps 1 to 4 grow with the size of the number. */
export function heatStep(value: number, maxAbs: number): number {
  if (value === 0 || maxAbs <= 0) return 0;
  return clamp(Math.ceil((Math.abs(value) / maxAbs) * 4), 1, 4);
}

function cellFill(value: number | null, maxAbs: number): string {
  if (value === null) return 'transparent';
  const step = heatStep(value, maxAbs);
  if (step === 0) return 'var(--pulse-chart-track)';
  return mix(value < 0 ? WARM : HUE, STEPS[step - 1]!);
}

export function HeatmapCalendar({ days, format, valueLabel = 'Amount', weekStart = 1, scale = 'auto', lowLabel, highLabel, ...base }: HeatmapCalendarProps) {
  const fmt = resolveFormat(format);
  const sorted = [...days].filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date)).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((day) => [day.date, day.value]));
  const first = sorted[0]?.date;
  const last = sorted[sorted.length - 1]?.date;
  const cells: { date: string; value: number | null; inRange: boolean }[] = [];
  if (first && last) {
    const lead = (weekdayOf(first) - weekStart + 7) % 7;
    const gridStart = shiftDate(first, -lead);
    for (let date = gridStart; date <= last || cells.length % 7 !== 0; date = shiftDate(date, 1)) {
      cells.push({ date, value: byDate.get(date) ?? null, inRange: date >= first && date <= last });
      if (cells.length > 7 * 60) break;
    }
  }
  const weeks = Math.ceil(cells.length / 7);
  const real = cells.filter((cell) => cell.value !== null).map((cell) => cell.value as number);
  const maxAbs = real.length ? Math.max(...real.map((value) => Math.abs(value))) : 0;
  const diverging = scale === 'diverging' || (scale === 'auto' && real.some((value) => value < 0));
  const empty = real.length === 0;

  const table = {
    columns: ['Day', valueLabel],
    rows: cells.filter((cell) => cell.inRange).map((cell) => [formatDateLong(cell.date), cell.value === null ? 'No data' : fmt.value(cell.value)]),
  };

  return (
    <ChartFrame {...base} empty={empty} hideLegend table={table} defaultHeight={150} height={empty || base.loading || base.error ? 150 : undefined}>
      {({ width, titleId, descId }) => (
        <Grid
          width={width}
          titleId={titleId}
          descId={descId}
          title={base.title}
          description={base.description}
          cells={cells}
          weeks={weeks}
          maxAbs={maxAbs}
          diverging={diverging}
          weekStart={weekStart}
          valueLabel={valueLabel}
          value={fmt.value}
          lowLabel={lowLabel ?? (diverging ? 'Below zero' : 'Less')}
          highLabel={highLabel ?? (diverging ? 'Above zero' : 'More')}
        />
      )}
    </ChartFrame>
  );
}

interface GridProps {
  readonly width: number;
  readonly titleId: string;
  readonly descId: string;
  readonly title: string;
  readonly description?: string;
  readonly cells: readonly { date: string; value: number | null; inRange: boolean }[];
  readonly weeks: number;
  readonly maxAbs: number;
  readonly diverging: boolean;
  readonly weekStart: number;
  readonly valueLabel: string;
  readonly value: (value: number) => string;
  readonly lowLabel: string;
  readonly highLabel: string;
}

function Grid({ width, titleId, descId, title, description, cells, weeks, maxAbs, diverging, weekStart, valueLabel, value, lowLabel, highLabel }: GridProps) {
  const gap = 3;
  const gutter = 30;
  const wideCell = Math.floor((width - gutter) / Math.max(1, weeks)) - gap;
  const vertical = wideCell < 9;
  const cellW = vertical ? clamp(Math.floor((width - 52) / 7) - gap, 14, 44) : clamp(wideCell, 9, 20);
  const cellH = vertical ? 20 : cellW;
  const headBand = 18;
  const gridLeft = vertical ? 52 : gutter;
  const svgWidth = vertical ? gridLeft + 7 * (cellW + gap) : gridLeft + weeks * (cellW + gap);
  const svgHeight = headBand + (vertical ? weeks : 7) * (cellH + gap);
  const position = (index: number): { x: number; y: number } => {
    const week = Math.floor(index / 7);
    const day = index % 7;
    return vertical ? { x: gridLeft + day * (cellW + gap), y: headBand + week * (cellH + gap) } : { x: gridLeft + week * (cellW + gap), y: headBand + day * (cellH + gap) };
  };
  const count = cells.length;
  const roving = useRoving(count, {
    start: 'last',
    move: (index, key) => {
      const across = vertical ? 1 : 7;
      const down = vertical ? 7 : 1;
      const step = key === 'ArrowRight' ? across : key === 'ArrowLeft' ? -across : key === 'ArrowDown' ? down : key === 'ArrowUp' ? -down : null;
      if (step === null) return undefined;
      let next = index + step;
      while (next >= 0 && next < count && !cells[next]!.inRange) next += Math.sign(step);
      return next >= 0 && next < count ? next : index;
    },
  });
  const firstIn = cells.findIndex((cell) => cell.inRange);
  let lastIn = -1;
  cells.forEach((cell, index) => {
    if (cell.inRange) lastIn = index;
  });
  const active = roving.active !== null && cells[roving.active]?.inRange ? roving.active : roving.active !== null ? clamp(roving.active, firstIn, lastIn) : null;

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const index = Number(event.currentTarget.dataset.index);
    if (index !== active) roving.hover(index);
  };

  const activeCell = active !== null ? cells[active] : undefined;
  const tooltip: TooltipModel | null =
    active !== null && activeCell
      ? {
          x: position(active).x + cellW / 2,
          y: position(active).y + cellH,
          title: formatDateLong(activeCell.date),
          rows: [{ id: 'value', label: valueLabel, value: activeCell.value === null ? 'No data' : value(activeCell.value), color: activeCell.value === null ? undefined : cellFill(activeCell.value, maxAbs), shape: 'box' }],
        }
      : null;

  // Month labels: at the first week that holds the 1st of a month (or the very first week).
  const monthMarks: { week: number; text: string }[] = [];
  for (let week = 0; week < weeks; week += 1) {
    const slice = cells.slice(week * 7, week * 7 + 7);
    const firstOfMonth = slice.find((cell) => cell.date.endsWith('-01'));
    const cell = week === 0 ? (slice.find((item) => item.inRange) ?? slice[0]) : firstOfMonth;
    if (!cell) continue;
    const text = MONTH_NAMES_SHORT[Number(cell.date.slice(5, 7)) - 1] ?? '';
    const previous = monthMarks[monthMarks.length - 1];
    if (previous && previous.text === text) continue;
    if (previous && !vertical && (week - previous.week) * (cellW + gap) < 28) monthMarks.pop();
    monthMarks.push({ week, text });
  }
  const weekdayAt = (row: number): string => WEEKDAY_NAMES_SHORT[(weekStart + row) % 7] ?? '';
  const keySwatches = diverging ? [mix(WARM, 100), mix(WARM, 44), 'var(--pulse-chart-track)', mix(HUE, 44), mix(HUE, 100)] : ['var(--pulse-chart-track)', ...STEPS.map((step) => mix(HUE, step))];

  return (
    <>
      <div className="relative">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          role="group"
          aria-roledescription="chart"
          aria-labelledby={`${titleId}-svg`}
          aria-describedby={`${descId}-svg`}
          tabIndex={0}
          onKeyDown={roving.onKeyDown}
          onFocus={roving.onFocus}
          onBlur={roving.onBlur}
          onPointerLeave={() => roving.hover(null)}
          className="block max-w-full touch-pan-y overflow-visible"
        >
          <SvgLabels titleId={titleId} descId={descId} title={title} description={description} hint="Use the arrow keys to move between days." />
          {vertical
            ? Array.from({ length: 7 }, (_, day) => (
                <text key={day} x={gridLeft + day * (cellW + gap) + cellW / 2} y={11} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                  {cellW < 26 ? weekdayAt(day).slice(0, 1) : weekdayAt(day)}
                </text>
              ))
            : [0, 2, 4, 6].map((day) => (
                <text key={day} x={0} y={headBand + day * (cellH + gap) + cellH / 2} dy="0.34em" fontSize={11} fill="var(--text-muted)">
                  {weekdayAt(day)}
                </text>
              ))}
          {monthMarks.map((mark) =>
            vertical ? (
              <text key={`${mark.week}-${mark.text}`} x={0} y={headBand + mark.week * (cellH + gap) + cellH / 2} dy="0.34em" fontSize={11} fill="var(--text-muted)">
                {mark.text}
              </text>
            ) : (
              <text key={`${mark.week}-${mark.text}`} x={gridLeft + mark.week * (cellW + gap)} y={11} fontSize={11} fill="var(--text-muted)">
                {mark.text}
              </text>
            ),
          )}
          {cells.map((cell, index) => {
            if (!cell.inRange) return null;
            const { x, y } = position(index);
            const hollow = cell.value === null;
            return (
              <rect
                key={cell.date}
                data-index={index}
                className="pc-mark"
                x={x}
                y={y}
                width={cellW}
                height={cellH}
                rx={3}
                fill={cellFill(cell.value, maxAbs)}
                stroke={hollow ? 'var(--pulse-chart-grid)' : 'none'}
                strokeWidth={hollow ? 1 : 0}
                strokeDasharray={hollow ? '2 2' : undefined}
                onPointerEnter={onMove}
                onPointerDown={onMove}
              />
            );
          })}
          {active !== null ? (
            <rect x={position(active).x - 1.5} y={position(active).y - 1.5} width={cellW + 3} height={cellH + 3} rx={4} fill="none" stroke={roving.byKeyboard ? 'var(--focus-ring)' : 'var(--text-primary)'} strokeWidth={1.5} pointerEvents="none" />
          ) : null}
        </svg>
        <ChartTooltip model={tooltip} boxWidth={Math.min(width, svgWidth)} />
        <ChartLive text={roving.byKeyboard ? tooltipText(tooltip) : ''} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          {lowLabel}
          <span aria-hidden className="inline-flex gap-[3px]">
            {keySwatches.map((fill, index) => (
              <span key={index} className="size-2.5 rounded-[3px]" style={{ background: fill }} />
            ))}
          </span>
          {highLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px] border border-dashed border-border-strong" />
          No data
        </span>
        <span>{`Full color at ${value(maxAbs)}`}</span>
      </div>
    </>
  );
}
