'use client';
/**
 * Timeline (Gantt) view: rows grouped by group / status, bars from a timeline (or date →
 * milestone) column, drag to move, drag edges to resize with a snapping "Nov 12 → Nov 19 (8d)"
 * tooltip, zoom Days / Weeks / Months / Quarters, Today line, Auto-fit (Z), group summary bars,
 * collapsible groups, keyboard nudge (←/→, Shift+←/→ resize) and "+ Set dates" for undated rows.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, Crosshair, Maximize2, Plus } from 'lucide-react';
import { Button, EmptyState, Select, Skeleton, Switch, ToggleGroup, Tooltip, cn, labelColorStyle } from '@/components/ui';
import { useCreateColumn } from '@/lib/hooks';
import type { ItemDto } from '@/server/services/contracts/dto';
import { columnOptions, FilteredEmpty, ResetSettings, SettingsSection, SettingsSelect, ViewCanvas, ViewError, ViewToolbar } from '../components/view-shell';
import { useCellWriter, useElementSize, useMediaQuery, useViewConfig, useViewModel, useViewShortcutsEnabled } from '../hooks';
import { isViewShortcut } from '../lib/shortcuts';
import { TIMELINE_ZOOMS, timelineSettings, type TimelineZoom } from '../lib/config';
import { addDays, diffDays, todayIso, type IsoDate } from '../lib/dates';
import { buildLanes, groupIntoLanes, type Lane } from '../lib/kanban';
import { buildTicks, computeRange, dayToX, fitZoom, PX_PER_DAY, ZOOM_LABELS } from '../lib/timeline';
import { cellOf, dateRangeOf, GROUP_KEY, itemColor, LABEL_COLUMN_TYPES, pluralNoun, rescheduledValue, resolveColorSource } from '../lib/values';
import type { BoardViewProps } from '../types';
import { TimelineBar } from './timeline-bar';

const ROW_H = 40;
const GROUP_H = 40;
const HEADER_H = 52;

export function TimelineSkeleton() {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading timeline" className="flex flex-1 flex-col gap-2 bg-panel p-4">
      {[0, 1, 2, 3, 4, 5, 6].map((row) => (
        <div key={row} className="flex h-8 items-center gap-4">
          <Skeleton width={200} height={12} rounded="full" />
          <Skeleton height={24} width={`${20 + ((row * 17) % 40)}%`} rounded="sm" style={{ marginLeft: `${(row * 9) % 30}%` }} />
        </div>
      ))}
    </div>
  );
}

export function TimelineView({ boardId, view, onOpenItem, initialSettingsOpen, className }: BoardViewProps) {
  const model = useViewModel(boardId, view);
  const { columns, groups, items, allItems, noun, canEdit } = model;
  const { save } = useViewConfig<Record<string, unknown>>(boardId, view, 'timeline');
  const settings = useMemo(() => timelineSettings(view.config, columns), [view.config, columns]);
  const writeCell = useCellWriter(boardId);
  const createColumn = useCreateColumn(boardId);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(initialSettingsOpen));
  const [zoom, setZoomState] = useState<TimelineZoom>(settings.zoom);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [measure, size] = useElementSize<HTMLDivElement>();
  const today = todayIso();

  const column = columns.find((entry) => entry.key === settings.columnKey);
  const editable = canEdit && Boolean(column);
  const milestone = column?.type === 'date';
  const pxPerDay = PX_PER_DAY[zoom];
  // Phones: a narrow label column (~29% of a 390px screen) leaves room for the bars.
  const nameWidth = size.width > 0 && size.width < 640 ? 112 : 260;
  const narrow = useMediaQuery('(max-width: 639px)');
  const [shortcutsOn, setShortcutsOn] = useViewShortcutsEnabled();

  const ranges = useMemo(() => {
    const map = new Map<string, { start: IsoDate; end: IsoDate }>();
    if (!column) return map;
    for (const item of items) {
      const range = dateRangeOf(cellOf(item, column.key));
      if (range) map.set(item.id, range);
    }
    return map;
  }, [items, column]);
  const range = useMemo(() => computeRange([...ranges.values()], today), [ranges, today]);
  const ticks = useMemo(() => buildTicks(range, zoom), [range, zoom]);
  const trackWidth = range.days * pxPerDay;

  const lanes: Lane[] = useMemo(() => {
    if (settings.groupBy === 'none') return [{ id: 'all', title: `All ${pluralNoun(noun, 2)}`, color: 'blue', value: null }];
    return buildLanes(settings.groupBy, columns, groups);
  }, [settings.groupBy, columns, groups, noun]);
  const rows = useMemo(() => {
    if (settings.groupBy === 'none') return new Map([['all', [...items].sort((a, b) => (ranges.get(a.id)?.start ?? 'z').localeCompare(ranges.get(b.id)?.start ?? 'z'))]]);
    return groupIntoLanes(items, lanes, settings.groupBy, columns);
  }, [items, lanes, settings.groupBy, columns, ranges]);
  const colorSource = useMemo(() => resolveColorSource(columns, settings.colorBy), [columns, settings.colorBy]);

  const setZoom = useCallback(
    (next: TimelineZoom) => {
      const node = scroller.current;
      // Keep the date at the viewport center anchored while zooming.
      const centerDay = node ? (node.scrollLeft + (node.clientWidth - nameWidth) / 2) / PX_PER_DAY[zoom] : 0;
      setZoomState(next);
      save({ zoom: next });
      requestAnimationFrame(() => {
        if (node) node.scrollLeft = centerDay * PX_PER_DAY[next] - (node.clientWidth - nameWidth) / 2;
      });
    },
    [nameWidth, save, zoom],
  );

  const scrollToDay = useCallback(
    (iso: IsoDate, behavior: ScrollBehavior = 'smooth') => {
      const node = scroller.current;
      if (!node) return;
      node.scrollTo({ left: Math.max(0, dayToX(range, iso, pxPerDay) - (node.clientWidth - nameWidth) / 3), behavior });
    },
    [nameWidth, pxPerDay, range],
  );

  const autoFit = useCallback(() => {
    const values = [...ranges.values()];
    if (values.length === 0 || !scroller.current) return;
    const start = values.reduce((min, entry) => (entry.start < min ? entry.start : min), values[0]?.start ?? today);
    const end = values.reduce((max, entry) => (entry.end > max ? entry.end : max), values[0]?.end ?? today);
    const next = fitZoom(diffDays(start, end) + 14, scroller.current.clientWidth - nameWidth);
    setZoomState(next);
    save({ zoom: next });
    requestAnimationFrame(() => {
      const node = scroller.current;
      if (node) node.scrollTo({ left: Math.max(0, dayToX(range, addDays(start, -7), PX_PER_DAY[next])), behavior: 'smooth' });
    });
  }, [nameWidth, range, ranges, save, today]);

  // Start at today.
  const didScroll = useRef(false);
  useEffect(() => {
    if (didScroll.current || !model.query.data || !scroller.current) return;
    didScroll.current = true;
    scrollToDay(today, 'auto');
  }, [model.query.data, scrollToDay, today]);

  // T / Z only while the timeline grid itself has focus, and switchable off (WCAG 2.1.4).
  const onShortcut = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isViewShortcut(event, scroller.current, shortcutsOn)) return;
    const key = event.key.toLowerCase();
    if (key === 'z') autoFit();
    else if (key === 't') scrollToDay(today);
    else return;
    event.preventDefault();
  };

  const commit = useCallback(
    (itemId: string, next: { start: IsoDate; end: IsoDate }) => {
      if (!column) return;
      const item = items.find((entry) => entry.id === itemId);
      void writeCell(itemId, column.key, rescheduledValue(column, item?.values[column.key], next.start, next.end), {
        failure: `Couldn't reschedule ${noun.toLowerCase()}`,
      });
    },
    [column, items, noun, writeCell],
  );

  const toggleGroup = (laneId: string) =>
    save({
      collapsedGroups: settings.collapsedGroups.includes(laneId)
        ? settings.collapsedGroups.filter((id) => id !== laneId)
        : [...settings.collapsedGroups, laneId],
    });

  const settingsPanel = (
    <>
      <SettingsSection title="Bars">
        <SettingsSelect
          label="Dates from"
          testId="timeline-column"
          value={settings.columnKey ?? ''}
          onChange={(value) => save({ columnKey: value })}
          options={columnOptions(columns, (entry) => entry.type === 'timeline' || entry.type === 'date')}
        />
        <SettingsSelect
          label="Color by"
          value={settings.colorBy}
          onChange={(value) => save({ colorBy: value })}
          options={[...columnOptions(columns, (entry) => LABEL_COLUMN_TYPES.has(entry.type)), { value: GROUP_KEY, label: 'Group' }, { value: 'none', label: 'Single color' }]}
        />
      </SettingsSection>
      <SettingsSection title="Rows">
        <SettingsSelect
          label="Group by"
          value={settings.groupBy}
          onChange={(value) => save({ groupBy: value, collapsedGroups: [] })}
          options={[{ value: GROUP_KEY, label: 'Group' }, ...columnOptions(columns, (entry) => LABEL_COLUMN_TYPES.has(entry.type)), { value: 'none', label: 'No grouping' }]}
        />
        <Switch size="sm" label="Group summary bars" checked={settings.showSummary} onCheckedChange={(checked) => save({ showSummary: checked })} />
        <Switch size="sm" label="Today line" checked={settings.showToday} onCheckedChange={(checked) => save({ showToday: checked })} />
        <Switch
          size="sm"
          label="Single-key shortcuts"
          description="T (today) and Z (auto fit) while the timeline has focus. Saved for you on this device."
          checked={shortcutsOn}
          onCheckedChange={setShortcutsOn}
        />
        <Switch size="sm" label="Shade weekends" checked={settings.showWeekends} onCheckedChange={(checked) => save({ showWeekends: checked })} />
      </SettingsSection>
      <ResetSettings onReset={() => save({ columnKey: undefined, zoom: undefined, groupBy: undefined, colorBy: undefined, showToday: undefined, showWeekends: undefined, showSummary: undefined, collapsedGroups: [] }, { immediate: true })} />
    </>
  );

  const todayX = dayToX(range, today, pxPerDay);
  const weekendStripes = zoom === 'day' && settings.showWeekends ? ticks.minor.filter((tick) => tick.weekend) : [];

  const renderRow = (item: ItemDto) => {
    const dates = ranges.get(item.id);
    const { color } = itemColor(item, colorSource, groups);
    return (
      <div role="row" key={item.id} className="group/row contents" data-item-id={item.id}>
        <div
          role="rowheader"
          className="sticky left-0 z-[var(--z-sticky)] flex items-center gap-2 border-r border-b border-border-subtle bg-panel px-3 group-hover/row:bg-muted"
          style={{ height: ROW_H, width: nameWidth }}
        >
          <button
            type="button"
            onClick={() => onOpenItem?.(item.id)}
            className="min-w-0 flex-1 truncate rounded-xs text-left text-sm text-fg hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            title={item.name}
          >
            {item.name}
          </button>
        </div>
        <div role="gridcell" className="relative border-b border-border-subtle group-hover/row:bg-[color-mix(in_srgb,var(--surface-hover)_60%,transparent)]" style={{ height: ROW_H, width: trackWidth }}>
          {dates ? (
            <TimelineBar
              itemId={item.id}
              name={item.name}
              start={dates.start}
              end={dates.end}
              left={dayToX(range, dates.start, pxPerDay)}
              width={(diffDays(dates.start, dates.end) + 1) * pxPerDay}
              pxPerDay={pxPerDay}
              color={color}
              milestone={milestone}
              editable={editable}
              resizable={column?.type === 'timeline'}
              onOpen={(id) => onOpenItem?.(id)}
              onCommit={commit}
            />
          ) : editable ? (
            <button
              type="button"
              data-testid="timeline-set-dates"
              onClick={() => commit(item.id, { start: today, end: addDays(today, 6) })}
              className="absolute top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 rounded-sm border border-dashed border-border-strong px-2 text-xs font-medium text-fg-secondary opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/row:opacity-100 hover:border-primary hover:text-primary-text focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus"
              style={{ left: todayX, minWidth: Math.max(96, 7 * pxPerDay) }}
            >
              <Plus aria-hidden className="size-3.5" /> Set dates
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  let body;
  if (model.query.isError && !model.query.data) body = <ViewError onRetry={() => void model.query.refetch()} what="the timeline" />;
  else if (!model.query.data) body = <TimelineSkeleton />;
  else if (!column)
    body = (
      <div className="flex flex-1 items-center justify-center bg-sunken">
        <EmptyState
          title="To use this view add a Timeline or Date column"
          description={`Bars are drawn from a timeline (start → end) or a date. Add one to plan your ${pluralNoun(noun, 2)}.`}
          actions={
            canEdit ? (
              <Button loading={createColumn.isPending} onClick={() => createColumn.mutate({ title: 'Timeline', type: 'timeline' }, { onSuccess: (created) => save({ columnKey: created.key }, { immediate: true }) })}>
                Add column
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  else if (items.length === 0)
    body = (
      <div className="flex flex-1 items-center justify-center bg-sunken">
        {allItems.length > 0 ? <FilteredEmpty noun={pluralNoun(noun, 2)} onClear={model.clearSearch} /> : <EmptyState size="sm" title={`No ${pluralNoun(noun, 2)} yet`} description="Items you add will appear here as bars." />}
      </div>
    );
  else
    body = (
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={scroller}
          role="grid"
          aria-label="Timeline"
          aria-rowcount={items.length}
          aria-keyshortcuts={shortcutsOn ? 'T Z' : undefined}
          tabIndex={0}
          onKeyDown={onShortcut}
          data-testid="timeline-grid"
          className="relative min-h-0 flex-1 overflow-auto bg-panel"
        >
          {/* Background layers (gridlines, weekends, today) sit UNDER the rows and bars. */}
          <div aria-hidden className="pointer-events-none absolute top-0" style={{ left: nameWidth, width: trackWidth, height: '100%', minHeight: '100%' }}>
            {weekendStripes.map((tick) => (
              <span key={tick.key} className="absolute inset-y-0 bg-[color-mix(in_srgb,var(--surface-sunken)_70%,transparent)]" style={{ left: tick.x, width: tick.width, top: HEADER_H }} />
            ))}
            {ticks.minor.map((tick) =>
              tick.width >= 24 ? (
                <span key={`m-${tick.key}`} className="absolute bottom-0 w-px bg-[color-mix(in_srgb,var(--border-subtle)_55%,transparent)]" style={{ left: tick.x, top: HEADER_H }} />
              ) : null,
            )}
            {ticks.major.map((tick) => (
              <span key={`M-${tick.key}`} className="absolute bottom-0 w-px bg-border-subtle" style={{ left: tick.x, top: HEADER_H }} data-testid="timeline-gridline" />
            ))}
            {settings.showToday ? <span className="absolute w-0.5 bg-danger/60" style={{ left: todayX + pxPerDay / 2 - 1, top: HEADER_H, bottom: 0 }} data-testid="timeline-today" /> : null}
          </div>
          <div className="relative grid" style={{ gridTemplateColumns: `${nameWidth}px ${trackWidth}px`, width: nameWidth + trackWidth }}>
            {/* Header */}
            <div role="row" className="contents">
              <div
                role="columnheader"
                className="sticky top-0 left-0 z-[var(--z-header)] flex items-end border-r border-b border-border-default bg-panel px-3 pb-2 text-xs font-semibold text-fg-muted uppercase"
                style={{ height: HEADER_H }}
              >
                {noun}
              </div>
              <div role="columnheader" className="sticky top-0 z-[var(--z-sticky)] border-b border-border-default bg-panel" style={{ height: HEADER_H }}>
                <div className="relative h-6 border-b border-border-subtle">
                  {ticks.major.map((tick) => (
                    <div key={tick.key} className="absolute top-0 h-6 truncate border-l border-border-subtle px-2 text-xs leading-6 font-semibold text-fg" style={{ left: tick.x, width: tick.width }}>
                      {tick.label}
                    </div>
                  ))}
                </div>
                <div className="relative h-[27px]">
                  {ticks.minor.map((tick) => (
                    <div
                      key={tick.key}
                      className={cn('absolute top-0 h-full truncate border-l border-border-subtle text-center text-2xs leading-[27px] text-fg-muted tabular-nums', tick.weekend && 'bg-sunken')}
                      style={{ left: tick.x, width: tick.width }}
                    >
                      {tick.width >= 14 ? tick.label : ''}
                    </div>
                  ))}
                  {settings.showToday ? (
                    <span className="absolute bottom-0 z-[var(--z-raised)] -translate-x-1/2 rounded-t-sm bg-danger px-1.5 text-2xs leading-4 font-semibold text-white" style={{ left: todayX + pxPerDay / 2 }}>
                      Today
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            {/* Body */}
            {lanes.map((lane) => {
              const laneItems = rows.get(lane.id) ?? [];
              if (laneItems.length === 0 && settings.groupBy !== GROUP_KEY) return null;
              const collapsed = settings.collapsedGroups.includes(lane.id);
              const dated = laneItems.map((item) => ranges.get(item.id)).filter((entry): entry is { start: IsoDate; end: IsoDate } => Boolean(entry));
              const summary = dated.length
                ? { start: dated.reduce((min, entry) => (entry.start < min ? entry.start : min), dated[0]?.start ?? today), end: dated.reduce((max, entry) => (entry.end > max ? entry.end : max), dated[0]?.end ?? today) }
                : null;
              return (
                <Fragment key={lane.id}>
                  <div role="row" className="contents" style={labelColorStyle(lane.color)}>
                    <div
                      role="rowheader"
                      className="sticky left-0 z-[var(--z-sticky)] flex items-center gap-1.5 border-r border-b border-border-subtle bg-panel pr-2"
                      style={{ height: GROUP_H, width: nameWidth, boxShadow: 'inset 6px 0 0 var(--lc-bg)', ...labelColorStyle(lane.color) }}
                    >
                      <button
                        type="button"
                        aria-expanded={!collapsed}
                        onClick={() => toggleGroup(lane.id)}
                        className="ml-2.5 flex min-w-0 flex-1 items-center gap-1 rounded-xs text-left text-sm font-semibold text-[var(--lc-text)] hover:brightness-90 focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        {collapsed ? <ChevronRight aria-hidden className="size-4 shrink-0" /> : <ChevronDown aria-hidden className="size-4 shrink-0" />}
                        <span className="truncate">{lane.title}</span>
                        <span className="shrink-0 font-normal text-fg-muted tabular-nums">· {laneItems.length}</span>
                      </button>
                    </div>
                    <div role="gridcell" className="relative border-b border-border-subtle bg-muted" style={{ height: GROUP_H, width: trackWidth, ...labelColorStyle(lane.color) }}>
                      {settings.showSummary && summary ? (
                        <Tooltip content={`${lane.title}: ${dated.length} scheduled`}>
                          <span
                            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-[var(--lc-bg)] opacity-80"
                            style={{ left: dayToX(range, summary.start, pxPerDay), width: Math.max(6, (diffDays(summary.start, summary.end) + 1) * pxPerDay) }}
                            data-testid="timeline-summary"
                          />
                        </Tooltip>
                      ) : null}
                    </div>
                  </div>
                  {collapsed ? null : laneItems.map(renderRow)}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    );

  return (
    <ViewCanvas testId="timeline-view" busy={!model.query.data} className={className}>
      <ViewToolbar
        search={model.search}
        onSearch={model.setSearch}
        searchLabel={`Search ${pluralNoun(noun, 2)}`}
        settings={settingsPanel}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
        settingsTitle="Timeline settings"
      >
        <div className="flex min-w-0 flex-nowrap items-center gap-2">
          <Button variant="secondary" size="sm" leadingIcon={<Crosshair aria-hidden />} onClick={() => scrollToDay(today)} title="Jump to today (T)" aria-label="Today">
            <span className="max-[639px]:sr-only">Today</span>
          </Button>
          {narrow ? (
            <span className="w-28 shrink-0" data-testid="timeline-zoom-select">
              <Select size="sm" aria-label="Zoom" value={zoom} onValueChange={(value) => setZoom(value as TimelineZoom)} options={TIMELINE_ZOOMS.map((entry) => ({ value: entry, label: ZOOM_LABELS[entry] }))} />
            </span>
          ) : (
            <ToggleGroup
              size="sm"
              label="Zoom"
              value={zoom}
              onValueChange={setZoom}
              options={TIMELINE_ZOOMS.map((entry) => ({ value: entry, label: ZOOM_LABELS[entry] }))}
            />
          )}
          <Button variant="ghost" size="sm" leadingIcon={<Maximize2 aria-hidden />} onClick={autoFit} title="Fit every bar (Z)" aria-label="Auto fit" disabled={ranges.size === 0}>
            <span className="max-[639px]:sr-only">Auto fit</span>
          </Button>
        </div>
        {column ? (
          <span className="truncate text-xs whitespace-nowrap text-fg-muted max-[900px]:hidden tabular-nums">
            {ranges.size} of {items.length} scheduled{milestone ? ' · milestones' : ''}
          </span>
        ) : null}
      </ViewToolbar>
      <div ref={measure} className="flex min-h-0 flex-1 flex-col">
        {body}
      </div>
    </ViewCanvas>
  );
}
