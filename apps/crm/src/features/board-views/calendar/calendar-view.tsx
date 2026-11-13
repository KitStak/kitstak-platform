'use client';
/**
 * Calendar view: Month / Week / Day of any date or timeline column. Drag events to reschedule
 * (keeps duration), drag from the "Unscheduled" tray to schedule, "+N more" overflow, quick
 * create on a day, color by status / group, and keyboard shortcuts (T, ←/→, M/W/D, N).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CalendarCheck, CalendarClock, ChevronLeft, ChevronRight, Keyboard } from 'lucide-react';
import { Button, EmptyState, IconButton, Kbd, Skeleton, Switch, ToggleGroup, Tooltip, cn } from '@/components/ui';
import { useCreateColumn, useCreateItem } from '@/lib/hooks';
import type { ItemDto } from '@/server/services/contracts/dto';
import { columnOptions, FilteredEmpty, ResetSettings, SettingsSection, SettingsSelect, ViewCanvas, ViewError, ViewToolbar } from '../components/view-shell';
import { useCellWriter, useMediaQuery, useViewConfig, useViewModel, useViewShortcutsEnabled } from '../hooks';
import { isViewShortcut } from '../lib/shortcuts';
import { calendarSettings, type CalendarSettings } from '../lib/config';
import { collectEvents, shiftRange, timeOf } from '../lib/calendar';
import { addDays, addMonths, formatIso, isWeekend, monthMatrix, todayIso, weekDays, type IsoDate } from '../lib/dates';
import { DATE_COLUMN_TYPES, GROUP_KEY, LABEL_COLUMN_TYPES, WRITABLE_DATE_TYPES, itemColor, pluralNoun, rescheduledValue, resolveColorSource } from '../lib/values';
import type { BoardViewProps } from '../types';
import { CalendarMonth, type CalendarGridCommon } from './calendar-month';
import { EventGhost, UnscheduledTray, type EventLook } from './calendar-parts';
import { CalendarWeek } from './calendar-week';

type Mode = CalendarSettings['mode'];

export function CalendarSkeleton() {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading calendar" className="grid flex-1 grid-cols-7 gap-px bg-border-subtle p-px">
      {Array.from({ length: 35 }, (_, index) => (
        <div key={index} className="flex min-h-[112px] flex-col gap-1.5 bg-panel p-2">
          <Skeleton width={18} height={14} rounded="full" />
          {index % 3 === 0 ? <Skeleton height={20} rounded="sm" /> : null}
          {index % 5 === 1 ? <Skeleton height={20} width="70%" rounded="sm" /> : null}
        </div>
      ))}
    </div>
  );
}

/** Days shown by "Week" on phones: a 3-day window keeps columns readable. */
const NARROW_WEEK_DAYS = 3;

export function CalendarView({ boardId, view, onOpenItem, initialSettingsOpen, className }: BoardViewProps) {
  const model = useViewModel(boardId, view);
  const { columns, groups, items, allItems, noun, canEdit } = model;
  const { save } = useViewConfig<Record<string, unknown>>(boardId, view, 'calendar');
  const settings = useMemo(() => calendarSettings(view.config, columns), [view.config, columns]);
  const writeCell = useCellWriter(boardId);
  const createItem = useCreateItem(boardId);
  const createColumn = useCreateColumn(boardId);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(initialSettingsOpen));
  const [today, setToday] = useState(() => todayIso());
  const [anchor, setAnchor] = useState<IsoDate>(() => todayIso());
  const [mode, setModeState] = useState<Mode>(settings.mode);
  const [trayOpen, setTrayOpen] = useState(settings.showUnscheduled);
  const [dragging, setDragging] = useState<ItemDto | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery('(max-width: 639px)');
  const [shortcutsOn, setShortcutsOn] = useViewShortcutsEnabled();

  useEffect(() => {
    const timer = setInterval(() => setToday(todayIso()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const dateColumn = columns.find((column) => column.key === settings.dateColumnKey);
  const canSchedule = canEdit && Boolean(dateColumn && WRITABLE_DATE_TYPES.has(dateColumn.type));
  const { events, unscheduled } = useMemo(() => collectEvents(items, dateColumn), [items, dateColumn]);
  const colorSource = useMemo(() => resolveColorSource(columns, settings.colorBy), [columns, settings.colorBy]);
  const look = useCallback(
    (item: ItemDto): EventLook => {
      const { color, label } = itemColor(item, colorSource, groups);
      return { color, label: colorSource.kind === 'column' ? label : null, groupTitle: groups.find((group) => group.id === item.groupId)?.title ?? null };
    },
    [colorSource, groups],
  );

  const setMode = (next: Mode) => {
    setModeState(next);
    save({ mode: next });
  };

  const step = useCallback(
    (delta: -1 | 1) =>
      setAnchor((current) =>
        mode === 'month' ? addMonths(current, delta) : addDays(current, delta * (mode === 'week' ? (narrow ? NARROW_WEEK_DAYS : 7) : 1)),
      ),
    [mode, narrow],
  );

  const range = useMemo(() => {
    const filterDays = (days: IsoDate[]) => (settings.hideWeekends ? days.filter((day) => !isWeekend(day)) : days);
    if (mode === 'month') {
      const weeks = monthMatrix(anchor, settings.weekStartsOn).map(filterDays);
      return { weeks, days: weeks.flat(), title: formatIso(anchor, 'month'), shortTitle: `${formatIso(anchor, 'monthShort')} ${anchor.slice(0, 4)}` };
    }
    if (mode === 'week') {
      const source = narrow ? Array.from({ length: NARROW_WEEK_DAYS }, (_, index) => addDays(anchor, index)) : weekDays(anchor, settings.weekStartsOn);
      const days = narrow ? source : filterDays(source);
      const first = days[0] ?? anchor;
      const last = days.at(-1) ?? anchor;
      return { weeks: [days], days, title: `${formatIso(first)} to ${formatIso(last, 'full')}`, shortTitle: first.slice(0, 7) === last.slice(0, 7) ? `${formatIso(first)} to ${Number(last.slice(8))}` : `${formatIso(first)} to ${formatIso(last)}` };
    }
    return { weeks: [[anchor]], days: [anchor], title: formatIso(anchor, 'weekdayLong'), shortTitle: formatIso(anchor, 'full') };
  }, [anchor, mode, narrow, settings.hideWeekends, settings.weekStartsOn]);

  const first = range.days[0] ?? anchor;
  const last = range.days.at(-1) ?? anchor;
  const inRange = events.filter((event) => event.start <= last && event.end >= first);

  const onCreate = useCallback(
    (date: IsoDate, name: string, time?: string) => {
      if (!dateColumn) return;
      const value = rescheduledValue(dateColumn, time ? { time } : undefined, date, date);
      createItem.mutate({ name, values: { [dateColumn.key]: value } as never });
    },
    [createItem, dateColumn],
  );

  const open = useCallback((itemId: string) => onOpenItem?.(itemId), [onOpenItem]);

  // Single-key shortcuts, scoped to the calendar region (focus on the grid, not on an event or
  // button inside it) and switchable off per viewer — WCAG 2.1.4.
  const onShortcut = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isViewShortcut(event, regionRef.current, shortcutsOn)) return;
    const key = event.key.toLowerCase();
    if (key === 't') setAnchor(todayIso());
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else if (key === 'm') setMode('month');
    else if (key === 'w') setMode('week');
    else if (key === 'd') setMode('day');
    else if (key === 'n' && canSchedule) {
      regionRef.current?.querySelector<HTMLButtonElement>(`[data-date="${today}"] button[aria-label^="New"]`)?.click();
    } else return;
    event.preventDefault();
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const onDragStart = (event: DragStartEvent) => {
    const itemId = (event.active.data.current as { itemId?: string } | undefined)?.itemId;
    setDragging(itemId ? (itemById.get(itemId) ?? null) : null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over || !dateColumn || !canSchedule) return;
    const data = active.data.current as { itemId: string; start?: IsoDate; end?: IsoDate; unscheduled?: boolean };
    const target = over.data.current as { date: IsoDate; minutes?: number };
    const item = itemById.get(data.itemId);
    if (!item || !target?.date) return;
    const previous = item.values[dateColumn.key];
    let next: unknown;
    if (data.unscheduled || !data.start || !data.end) {
      next = rescheduledValue(dateColumn, undefined, target.date, target.date);
    } else {
      const shifted = shiftRange({ start: data.start, end: data.end }, target.date);
      if (shifted.start === data.start && target.minutes === undefined) return;
      next = rescheduledValue(dateColumn, previous, shifted.start, shifted.end);
    }
    if (target.minutes !== undefined && dateColumn.type === 'date') next = { ...(next as object), time: timeOf(target.minutes) };
    void writeCell(item.id, dateColumn.key, next, { failure: `Couldn't reschedule ${noun.toLowerCase()}` });
  };

  const settingsPanel = (
    <>
      <SettingsSection title="Dates">
        <SettingsSelect
          label="Date column"
          testId="calendar-date-column"
          value={settings.dateColumnKey ?? ''}
          onChange={(value) => save({ dateColumnKey: value })}
          options={columnOptions(columns, (column) => DATE_COLUMN_TYPES.has(column.type))}
        />
        <SettingsSelect
          label="Week starts on"
          value={String(settings.weekStartsOn)}
          onChange={(value) => save({ weekStartsOn: Number(value) })}
          options={[
            { value: '0', label: 'Sunday' },
            { value: '1', label: 'Monday' },
          ]}
        />
        <SettingsSelect
          label="Event length"
          value={String(settings.eventDuration)}
          onChange={(value) => save({ eventDuration: Number(value) })}
          options={[30, 45, 60, 90, 120, 180, 240].map((minutes) => ({ value: String(minutes), label: minutes < 60 ? `${minutes} min` : `${minutes / 60} h` }))}
        />
        <Switch size="sm" label="Hide weekends" checked={settings.hideWeekends} onCheckedChange={(checked) => save({ hideWeekends: checked })} />
      </SettingsSection>
      <SettingsSection title="Appearance">
        <SettingsSelect
          label="Color by"
          value={settings.colorBy}
          onChange={(value) => save({ colorBy: value })}
          options={[...columnOptions(columns, (column) => LABEL_COLUMN_TYPES.has(column.type)), { value: GROUP_KEY, label: 'Group' }, { value: 'none', label: 'Single color' }]}
        />
        <Switch size="sm" label="Open unscheduled tray by default" checked={settings.showUnscheduled} onCheckedChange={(checked) => save({ showUnscheduled: checked })} />
        <Switch
          size="sm"
          label="Single-key shortcuts"
          description="T, M, W, D, N and arrow keys while the calendar grid has focus. Saved for you on this device."
          checked={shortcutsOn}
          onCheckedChange={setShortcutsOn}
          data-testid="calendar-shortcuts-toggle"
        />
      </SettingsSection>
      <ResetSettings onReset={() => save({ dateColumnKey: undefined, mode: undefined, weekStartsOn: undefined, hideWeekends: undefined, colorBy: undefined, showUnscheduled: undefined, eventDuration: undefined }, { immediate: true })} />
    </>
  );

  const weekdayLabels = (range.weeks[0] ?? []).map((day) => formatIso(day, 'weekday'));
  const common: CalendarGridCommon = { events: inRange, look, today, noun, canSchedule, onOpen: open, onCreate };

  const emptyRange = Boolean(model.query.data && dateColumn && inRange.length === 0 && items.length > 0);
  let body;
  if (model.query.isError && !model.query.data) body = <ViewError onRetry={() => void model.query.refetch()} what="the calendar" />;
  else if (!model.query.data) body = <CalendarSkeleton />;
  else if (!dateColumn)
    body = (
      <div className="flex flex-1 items-center justify-center bg-sunken">
        <EmptyState
          title="Add a date to see the calendar"
          description={`This board has no date or timeline column yet. Add one to plot ${pluralNoun(noun, 2)} by day.`}
          actions={
            canEdit ? (
              <Button loading={createColumn.isPending} onClick={() => createColumn.mutate({ title: 'Date', type: 'date' }, { onSuccess: (column) => save({ dateColumnKey: column.key }, { immediate: true }) })}>
                Add a date column
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  else if (items.length === 0 && allItems.length > 0)
    body = (
      <div className="flex flex-1 items-center justify-center bg-sunken">
        <FilteredEmpty noun={pluralNoun(noun, 2)} onClear={model.clearSearch} />
      </div>
    );
  else
    body = (
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div
          ref={regionRef}
          tabIndex={0}
          role="region"
          aria-label={`Calendar, ${range.title}`}
          aria-keyshortcuts={shortcutsOn ? 'T M W D N ArrowLeft ArrowRight' : undefined}
          onKeyDown={onShortcut}
          data-testid="calendar-region"
          className="relative flex min-h-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          {emptyRange ? (
            <p
              className="pointer-events-none absolute top-1/2 left-1/2 z-[var(--z-raised)] -translate-x-1/2 -translate-y-1/2 rounded-pill border border-border-subtle bg-raised px-4 py-2 text-sm text-fg-secondary shadow-md"
              data-testid="calendar-empty-range"
            >
              Nothing scheduled in this range
            </p>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto">
            <div className={cn('flex min-h-0 flex-1 flex-col', mode === 'month' && !narrow && 'min-w-[640px]')}>
              {mode === 'month' ? (
                <CalendarMonth weeks={range.weeks} anchor={anchor} weekdayLabels={weekdayLabels} common={common} />
              ) : (
                <CalendarWeek days={range.days} common={common} eventDuration={settings.eventDuration} timedEnabled={dateColumn.type === 'date'} />
              )}
            </div>
          </div>
          {trayOpen ? (
            <UnscheduledTray items={unscheduled} looks={look} noun={noun} onOpen={open} onClose={() => setTrayOpen(false)} draggable={canSchedule} />
          ) : null}
        </div>
        <DragOverlay dropAnimation={null}>{dragging ? <EventGhost item={dragging} look={look(dragging)} /> : null}</DragOverlay>
      </DndContext>
    );

  return (
    <ViewCanvas testId="calendar-view" busy={!model.query.data} className={className}>
      <div className="contents">
        <ViewToolbar
          search={model.search}
          onSearch={model.setSearch}
          searchLabel={`Search ${pluralNoun(noun, 2)}`}
          settings={settingsPanel}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          settingsTitle="Calendar settings"
          end={
            dateColumn ? (
              <Button
                variant={trayOpen ? 'secondary' : 'ghost'}
                size="sm"
                data-pressed={trayOpen}
                aria-pressed={trayOpen}
                leadingIcon={<CalendarClock aria-hidden />}
                onClick={() => setTrayOpen((value) => !value)}
                data-testid="unscheduled-toggle"
              >
                <span className="max-[640px]:sr-only">Unscheduled</span>
                <span className="tabular-nums">({unscheduled.length})</span>
              </Button>
            ) : null
          }
        >
          <div className="flex min-w-0 flex-nowrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAnchor(todayIso())} title="Today" leadingIcon={narrow ? <CalendarCheck aria-hidden /> : undefined} aria-label="Today">
              <span className="max-[639px]:sr-only">Today</span>
            </Button>
            <div className="flex shrink-0 items-center">
              <IconButton size="sm" label={`Previous ${mode}`} shortcut={['←']} icon={<ChevronLeft aria-hidden />} onClick={() => step(-1)} />
              <IconButton size="sm" label={`Next ${mode}`} shortcut={['→']} icon={<ChevronRight aria-hidden />} onClick={() => step(1)} />
            </div>
            <h2 className="min-w-0 truncate text-lg font-semibold whitespace-nowrap text-fg max-[639px]:text-md" aria-live="polite" data-testid="calendar-title">
              <span className="max-[1100px]:hidden">{range.title}</span>
              <span className="hidden max-[1100px]:inline">{range.shortTitle}</span>
            </h2>
          </div>
          <div className="max-[639px]:order-last max-[639px]:basis-full">
            <ToggleGroup
              size="sm"
              label="Calendar range"
              value={mode}
              onValueChange={setMode}
              options={[
                { value: 'month', label: 'Month' },
                { value: 'week', label: narrow ? '3 days' : 'Week' },
                { value: 'day', label: 'Day' },
              ]}
            />
          </div>
          {dateColumn && unscheduled.length > 0 && !trayOpen ? (
            <span className="truncate text-xs whitespace-nowrap text-fg-muted max-[1200px]:hidden">
              {unscheduled.length} {pluralNoun(noun, unscheduled.length)} without {dateColumn.title.toLowerCase()} hidden
            </span>
          ) : null}
          <Tooltip
            content={
              <span className="flex flex-col gap-1 text-xs">
                <span>
                  <Kbd>T</Kbd> today · <Kbd>←</Kbd>
                  <Kbd>→</Kbd> page
                </span>
                <span>
                  <Kbd>M</Kbd>
                  <Kbd>W</Kbd>
                  <Kbd>D</Kbd> range · <Kbd>N</Kbd> new
                </span>
                <span>{shortcutsOn ? 'Focus the calendar grid to use them.' : 'Turned off in Customize.'}</span>
              </span>
            }
          >
            <IconButton size="sm" variant="ghost" label="Keyboard shortcuts" icon={<Keyboard aria-hidden />} className="max-[639px]:hidden" />
          </Tooltip>
        </ViewToolbar>
        {body}
      </div>
    </ViewCanvas>
  );
}
