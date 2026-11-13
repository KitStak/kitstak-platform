'use client';

/**
 * Calendar (month / week / agenda) and Timeline (Gantt summary) widgets over item rows.
 *
 * Calendar: chips carry a status dot (not a full fill) so titles stay readable; the month grid
 * shows only the weeks of the month; short cards default to the week view and narrow cards
 * use an agenda (week strip with dots + the selected day's items).
 * Timeline: the window follows the dashboard date filter (or the items' own span, clamped);
 * cut bars show an overflow caret; the today line is primary with a cap label.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton, Tooltip, cn, type LabelColor } from '@/components/ui';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import type { WidgetSettings } from '@/server/services/contracts/dashboard-insights';
import { cssColor, seriesColor } from '../lib/colors';
import { useFilterHint } from './filter-context';
import { NoDataState } from './shared';
import type { WidgetRenderProps } from './types';
import { useElementSize } from './use-element-size';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Cards shorter than this open in week view. */
const WEEK_VIEW_BELOW = 700;
/** Cards narrower than this use the agenda layout. */
const AGENDA_BELOW = 420;
/** Week view uses 7 columns only from this card width; narrower cards list the days as rows. */
const WEEK_COLUMNS_FROM = 760;

export interface TimedRow {
  readonly item: ItemDto;
  readonly from: string;
  readonly to: string;
  readonly color: LabelColor;
  readonly label: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function findColumn(columns: readonly ColumnDto[], boardId: string, key: string | undefined, types: readonly string[]): ColumnDto | undefined {
  const board = columns.filter((column) => column.boardId === boardId);
  return (key ? board.find((column) => column.key === key) : undefined) ?? board.find((column) => types.includes(column.type));
}

/** Resolve each item's span and color from the widget's date/color columns. */
export function timedRows(rows: readonly ItemDto[], columns: readonly ColumnDto[], settings: WidgetSettings): TimedRow[] {
  const out: TimedRow[] = [];
  rows.forEach((item, index) => {
    const dateColumn = findColumn(columns, item.boardId, settings.dateColumnKey, ['date', 'timeline']);
    const raw = record(dateColumn ? item.values[dateColumn.key] : undefined);
    let from: string | null = null;
    let to: string | null = null;
    if (raw && typeof raw.from === 'string') {
      from = raw.from.slice(0, 10);
      to = typeof raw.to === 'string' ? raw.to.slice(0, 10) : from;
    } else if (raw && typeof raw.date === 'string') {
      from = raw.date.slice(0, 10);
      to = from;
    }
    if (!from || !to) return;
    const colorColumn = findColumn(columns, item.boardId, settings.colorByColumnKey, ['status']);
    const labelId = record(colorColumn ? item.values[colorColumn.key] : undefined)?.labelId;
    const labels = (colorColumn?.settings as { labels?: { id: string; name: string; color: string }[] } | undefined)?.labels ?? [];
    const label = labels.find((entry) => entry.id === (typeof labelId === 'string' ? labelId : 'default'));
    out.push({ item, from, to, color: seriesColor(label?.color, index), label: label?.name || null });
  });
  return out;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parse(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(value: string, days: number): string {
  return iso(new Date(parse(value).getTime() + days * DAY_MS));
}

function shortDate(value: string): string {
  return parse(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function itemHref(orgSlug: string, item: ItemDto): string {
  return `/${orgSlug}/boards/${item.boardId}?item=${item.id}`;
}

/** Monday-first grid covering only the weeks that touch the month containing `anchor` (4-6 weeks). */
export function monthGrid(anchor: Date): string[] {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = first.getTime() - offset * DAY_MS;
  const days = Math.round((last.getTime() - start) / DAY_MS) + 1;
  const weeks = Math.ceil(days / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => iso(new Date(start + index * DAY_MS)));
}

/** Monday of the week containing `value`. */
export function weekStart(value: string): string {
  const date = parse(value);
  return addDays(value, -((date.getUTCDay() + 6) % 7));
}

function Chip({ entry, orgSlug }: { readonly entry: TimedRow; readonly orgSlug: string }) {
  return (
    <Link
      href={itemHref(orgSlug, entry.item)}
      title={`${entry.item.name}${entry.label ? ` · ${entry.label}` : ''}`}
      className="flex min-w-0 items-center gap-1.5 rounded-xs px-1 text-xs leading-5 text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: cssColor(entry.color) }} />
      <span className="truncate">{entry.item.name}</span>
    </Link>
  );
}

type CalendarView = 'month' | 'week';

function ViewToggle({ view, onChange }: { readonly view: CalendarView; readonly onChange: (view: CalendarView) => void }) {
  return (
    <div role="radiogroup" aria-label="Calendar view" className="flex rounded-sm border border-border-subtle p-0.5">
      {(['month', 'week'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={view === option}
          onClick={() => onChange(option)}
          className={cn(
            'h-6 rounded-xs px-2 text-xs font-medium capitalize outline-none transition-colors duration-[var(--duration-instant)] focus-visible:outline-2 focus-visible:outline-focus',
            view === option ? 'bg-primary-subtle text-primary-text' : 'text-fg-secondary hover:bg-hover',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function CalendarWidget({ insight, settings, orgSlug, filtered, onConfigure }: WidgetRenderProps) {
  const rows = useMemo(() => timedRows(insight.rows, insight.columns, settings), [insight.rows, insight.columns, settings]);
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [chosenView, setView] = useState<CalendarView | null>(null);
  const [offset, setOffset] = useState(0);
  const today = iso(new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const agenda = size.width > 0 && size.width < AGENDA_BELOW;
  const view: CalendarView = agenda ? 'week' : (chosenView ?? (size.height > 0 && size.height < WEEK_VIEW_BELOW ? 'week' : 'month'));
  const byDay = useMemo(() => {
    const map = new Map<string, TimedRow[]>();
    for (const row of rows) map.set(row.from, [...(map.get(row.from) ?? []), row]);
    return map;
  }, [rows]);
  if (rows.length === 0) return <NoDataState filtered={filtered} onConfigure={onConfigure} />;

  const now = new Date();
  const monthAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const firstOfWeek = addDays(weekStart(today), offset * 7);
  const days = view === 'month' ? monthGrid(monthAnchor) : Array.from({ length: 7 }, (_, index) => addDays(firstOfWeek, index));
  const month = monthAnchor.getUTCMonth();
  const title =
    view === 'month'
      ? monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : `${shortDate(days[0]!)} to ${shortDate(days[6]!)}`;
  const weeks = days.length / 7;
  const perCell = view === 'week' ? 12 : Math.max(1, Math.floor((size.height - 80) / weeks / 22) - 1);
  // Agenda: default to today, or the next day of the week that has something on it.
  const busyDay = days.find((day) => day >= today && (byDay.get(day)?.length ?? 0) > 0) ?? days.find((day) => (byDay.get(day)?.length ?? 0) > 0);
  const selectedDay = selected && days.includes(selected) ? selected : (busyDay ?? days[0]!);

  const header = (
    <div className="flex items-center gap-1">
      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg" aria-live="polite">
        {title}
      </h3>
      {!agenda ? <ViewToggle view={view} onChange={(next) => { setView(next); setOffset(0); }} /> : null}
      <button
        type="button"
        onClick={() => { setOffset(0); setSelected(null); }}
        className="h-7 rounded-sm px-2 text-xs font-medium text-fg-secondary outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
      >
        Today
      </button>
      <IconButton label={view === 'month' ? 'Previous month' : 'Previous week'} icon={<ChevronLeft />} size="sm" onClick={() => setOffset((value) => value - 1)} />
      <IconButton label={view === 'month' ? 'Next month' : 'Next week'} icon={<ChevronRight />} size="sm" onClick={() => setOffset((value) => value + 1)} />
    </div>
  );

  if (agenda) {
    const entries = byDay.get(selectedDay) ?? [];
    return (
      <div ref={ref} className="flex h-full min-h-0 flex-col gap-2" data-testid="calendar-widget" data-view="agenda">
        {header}
        <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Days of the week">
          {days.map((day, index) => {
            const count = byDay.get(day)?.length ?? 0;
            const active = day === selectedDay;
            return (
              <button
                key={day}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`${shortDate(day)}, ${count} ${count === 1 ? 'item' : 'items'}`}
                onClick={() => setSelected(day)}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-md py-1 outline-none transition-colors duration-[var(--duration-instant)] focus-visible:outline-2 focus-visible:outline-focus',
                  active ? 'bg-primary-subtle text-primary-text' : 'text-fg-secondary hover:bg-hover',
                )}
              >
                <span className="text-2xs font-medium">{WEEKDAYS[index]}</span>
                <span className={cn('flex size-6 items-center justify-center rounded-full text-sm tabular-nums', day === today && 'bg-primary font-semibold text-primary-fg')}>
                  {Number(day.slice(8))}
                </span>
                <span className="flex h-1.5 gap-0.5" aria-hidden>
                  {(byDay.get(day) ?? []).slice(0, 3).map((entry) => (
                    <span key={entry.item.id} className="size-1.5 rounded-full" style={{ background: cssColor(entry.color) }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto border-t border-border-subtle pt-1" aria-label={`Items on ${shortDate(selectedDay)}`}>
          {entries.length === 0 ? <li className="px-1 py-3 text-center text-sm text-fg-muted">Nothing on {shortDate(selectedDay)}</li> : null}
          {entries.map((entry) => (
            <li key={entry.item.id} className="py-0.5">
              <Chip entry={entry} orgSlug={orgSlug} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (view === 'week' && size.width < WEEK_COLUMNS_FROM) {
    // Week view on a medium card: one row per day so titles get the full width.
    return (
      <div ref={ref} className="flex h-full min-h-0 flex-col gap-2" data-testid="calendar-widget" data-view="week-list">
        {header}
        <ol className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">
          {days.map((day, index) => {
            const entries = byDay.get(day) ?? [];
            return (
              <li key={day} className={cn('flex gap-3 px-2 py-1.5', day === today && 'bg-primary-subtle/40')}>
                <span className="flex w-12 shrink-0 flex-col items-center pt-0.5">
                  <span className="text-2xs font-medium text-fg-muted">{WEEKDAYS[index]}</span>
                  <span className={cn('flex size-6 items-center justify-center rounded-full text-sm tabular-nums', day === today ? 'bg-primary font-semibold text-primary-fg' : 'text-fg-secondary')}>
                    {Number(day.slice(8))}
                  </span>
                </span>
                <span className="grid min-w-0 flex-1 grid-cols-1 content-center gap-x-3 sm:grid-cols-2">
                  {entries.length === 0 ? <span className="text-xs leading-5 text-fg-muted">Nothing scheduled</span> : null}
                  {entries.map((entry) => (
                    <Chip key={entry.item.id} entry={entry} orgSlug={orgSlug} />
                  ))}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col gap-2" data-testid="calendar-widget" data-view={view}>
      {header}
      <div className="grid grid-cols-7 text-center text-2xs font-medium text-fg-muted">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden rounded-md border border-border-subtle bg-border-subtle [gap:1px]"
        style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {days.map((day) => {
          const entries = byDay.get(day) ?? [];
          const inMonth = view === 'week' || parse(day).getUTCMonth() === month;
          const shown = entries.slice(0, perCell);
          return (
            <div key={day} className={cn('flex min-h-0 flex-col gap-0.5 p-1', view === 'week' ? 'overflow-y-auto' : 'overflow-hidden', inMonth ? 'bg-panel' : 'bg-muted')}>
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full text-2xs tabular-nums',
                  day === today ? 'bg-primary font-semibold text-primary-fg' : inMonth ? 'text-fg-secondary' : 'text-fg-muted',
                )}
              >
                {Number(day.slice(8))}
              </span>
              {shown.map((entry) => (
                <Chip key={entry.item.id} entry={entry} orgSlug={orgSlug} />
              ))}
              {entries.length > shown.length ? (
                <Tooltip content={entries.slice(shown.length).map((entry) => entry.item.name).join(', ')}>
                  <span tabIndex={0} className="truncate rounded-xs px-1 text-xs text-fg-muted outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
                    +{entries.length - shown.length} more
                  </span>
                </Tooltip>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TIMELINE_ROWS = 40;
const DEFAULT_PAST_MONTHS = 1;
const DEFAULT_FUTURE_MONTHS = 3;
const MAX_WINDOW_MONTHS = 12;

function monthStart(value: string): string {
  const date = parse(value);
  return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

function monthEnd(value: string): string {
  const date = parse(value);
  return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

/**
 * Timeline window: the dashboard date filter when one is set; otherwise the items' own span
 * snapped to whole months, kept within a year and never shorter than the default 4 months.
 */
export function timelineWindow(
  rows: readonly Pick<TimedRow, 'from' | 'to'>[],
  today: string,
  filter: { from?: string; to?: string } = {},
): { start: string; end: string } {
  if (filter.from && filter.to) return { start: filter.from, end: filter.to };
  const todayDate = parse(today);
  const defaultStart = iso(new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - DEFAULT_PAST_MONTHS, 1)));
  const defaultEnd = iso(new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + DEFAULT_FUTURE_MONTHS + 1, 0)));
  if (rows.length === 0) return { start: filter.from ?? defaultStart, end: filter.to ?? defaultEnd };
  const earliest = rows.reduce((min, row) => (row.from < min ? row.from : min), rows[0]!.from);
  const latest = rows.reduce((max, row) => (row.to > max ? row.to : max), rows[0]!.to);
  let start = filter.from ?? monthStart(earliest < defaultStart ? earliest : defaultStart);
  let end = filter.to ?? monthEnd(latest > defaultEnd ? latest : defaultEnd);
  const limitStart = iso(new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - MAX_WINDOW_MONTHS / 2, 1)));
  const limitEnd = iso(new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + MAX_WINDOW_MONTHS / 2 + 1, 0)));
  if (!filter.from && start < limitStart) start = limitStart;
  if (!filter.to && end > limitEnd) end = limitEnd;
  return { start, end };
}

/** Approximate rendered widths of axis labels (11px font) and half the Today pill. */
const TICK_LABEL_PX = 30;
const TICK_LABEL_YEAR_PX = 46;
const TODAY_PILL_HALF_PX = 22;

function monthTicks(start: string, end: string): string[] {
  const ticks: string[] = [];
  const first = parse(monthStart(start));
  for (let index = 0; index < 36; index += 1) {
    const tick = iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1)));
    if (tick > end) break;
    if (tick >= start) ticks.push(tick);
  }
  if (ticks.length > 7) {
    const step = Math.ceil(ticks.length / 6);
    return ticks.filter((_, index) => index % step === 0);
  }
  return ticks;
}

export function TimelineWidget({ insight, settings, orgSlug, filtered, onConfigure }: WidgetRenderProps) {
  const hint = useFilterHint();
  const rows = useMemo(() => timedRows(insight.rows, insight.columns, settings), [insight.rows, insight.columns, settings]);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [axisRef, axis] = useElementSize<HTMLDivElement>();
  const today = iso(new Date());
  const { start, end } = timelineWindow(rows, today, hint?.hasRange ? { from: hint.from, to: hint.to } : {});
  const inWindow = rows.filter((row) => row.to >= start && row.from <= end);
  const visible = inWindow.slice(0, TIMELINE_ROWS);
  if (visible.length === 0) return <NoDataState filtered={filtered} onConfigure={onConfigure} />;
  const span = parse(end).getTime() - parse(start).getTime() + DAY_MS;
  const pct = (value: string) => ((parse(value).getTime() - parse(start).getTime()) / span) * 100;
  const ticks = monthTicks(start, end);
  const todayPct = pct(today);
  const showToday = todayPct >= 0 && todayPct <= 100;
  const hidden = inWindow.length - visible.length;
  const withYear = ticks.length > 6;
  // A month label runs right from its tick; hide it when its box would meet the Today pill.
  const labelPx = withYear ? TICK_LABEL_YEAR_PX : TICK_LABEL_PX;
  const todayPx = (todayPct / 100) * axis.width;
  const tickVisible = (tick: string) => {
    if (!showToday || axis.width <= 0) return !showToday || Math.abs(pct(tick) - todayPct) > 6;
    const left = (pct(tick) / 100) * axis.width - 2;
    return left + labelPx < todayPx - TODAY_PILL_HALF_PX || left > todayPx + TODAY_PILL_HALF_PX;
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="timeline-widget">
      <div className="grid grid-cols-[minmax(120px,28%)_1fr] border-b border-border-subtle pb-1 text-2xs font-medium text-fg-muted">
        <span>Item</span>
        <div ref={axisRef} className="relative h-4">
          {ticks.filter(tickVisible).map((tick) => (
            <span key={tick} className="absolute top-0 border-l border-border-subtle pl-1 whitespace-nowrap" style={{ left: `${pct(tick)}%` }}>
              {parse(tick).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC', ...(withYear ? { year: '2-digit' } : {}) })}
            </span>
          ))}
          {showToday ? (
            <span className="absolute -top-0.5 z-[1] -translate-x-1/2 rounded-xs bg-primary px-1 text-2xs leading-4 font-semibold text-primary-fg" style={{ left: `${todayPct}%` }}>
              Today
            </span>
          ) : null}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <ul
          className="relative h-full overflow-y-auto [scrollbar-gutter:stable]"
          onScroll={(event) => {
            const node = event.currentTarget;
            setScrolledToEnd(node.scrollTop + node.clientHeight >= node.scrollHeight - 4);
          }}
        >
          {visible.map((row) => {
            const cutStart = row.from < start;
            const cutEnd = row.to > end;
            const left = Math.max(pct(row.from), 0);
            const right = Math.min(pct(row.to) + (DAY_MS / span) * 100, 100);
            const dates = row.from === row.to ? shortDate(row.from) : `${shortDate(row.from)} to ${shortDate(row.to)}`;
            return (
              <li key={row.item.id} className="grid grid-cols-[minmax(120px,28%)_1fr] items-center border-b border-border-subtle/60 py-1 hover:bg-hover">
                <Link href={itemHref(orgSlug, row.item)} className="truncate pr-2 text-sm text-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                  {row.item.name}
                </Link>
                <div className="group/bar relative h-5">
                  <Tooltip content={`${row.item.name}: ${dates}${row.label ? ` · ${row.label}` : ''}`}>
                    <span
                      tabIndex={0}
                      aria-label={`${row.item.name}, ${dates}`}
                      className={cn(
                        'absolute top-0.5 flex h-4 min-w-1.5 items-center outline-none hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                        cutStart ? 'rounded-r-full' : cutEnd ? 'rounded-l-full' : 'rounded-full',
                        cutStart && cutEnd && 'rounded-none',
                      )}
                      style={{ left: `${left}%`, width: `${Math.max(right - left, 0.8)}%`, background: cssColor(row.color) }}
                    >
                      {cutStart ? <ChevronLeft aria-hidden className="size-3 shrink-0 text-[var(--surface-panel)]" /> : null}
                      {cutEnd ? <ChevronRight aria-hidden className="ml-auto size-3 shrink-0 text-[var(--surface-panel)]" /> : null}
                    </span>
                  </Tooltip>
                  {right < 82 ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-0.5 pl-1.5 text-2xs leading-4 whitespace-nowrap text-fg-muted opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/bar:opacity-100"
                      style={{ left: `${right}%` }}
                    >
                      {dates}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
          {showToday ? (
            <li aria-hidden className="pointer-events-none absolute top-0 bottom-0 grid w-full grid-cols-[minmax(120px,28%)_1fr]">
              <span />
              <span className="relative">
                <span className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 rounded-full bg-primary/70" style={{ left: `${todayPct}%` }} />
              </span>
            </li>
          ) : null}
        </ul>
        {!scrolledToEnd && visible.length > 6 ? (
          <span aria-hidden className="pointer-events-none absolute right-0 bottom-0 left-0 h-8 bg-gradient-to-t from-[var(--surface-panel)] to-transparent" />
        ) : null}
      </div>
      <p className="shrink-0 pt-1.5 text-xs text-fg-muted">
        {hidden > 0 ? `Showing ${visible.length} of ${inWindow.length} items` : `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`} ·{' '}
        {shortDate(start)} to {shortDate(end)}
      </p>
    </div>
  );
}
