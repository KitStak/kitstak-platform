'use client';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { AlarmClock, CalendarDays, CalendarRange, Check, CircleAlert, Clock } from 'lucide-react';
import { Button, Calendar, RangeCalendar, Switch, Tooltip, cn, labelColorStyle, toLabelColor, type DateRange } from '@/components/ui';
import { ONE_MONTH_QUERY, useMediaQuery } from '../parts/use-media';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { parseDateInput, parseTimeInput } from '../lib/date-parse';
import { useTabFlush } from '../parts/use-tab-flush';
import {
  dateUrgency,
  formatDateValue,
  formatDuration,
  formatTime,
  formatTimelineRange,
  parseIsoDate,
  timelineDays,
  timelineProgress,
  toIsoDate,
  type DateDisplayFormat,
} from '../lib/format';
import { isItemDone, readDate, readTimeline } from '../lib/values';
import { EmptyGhost, TruncText } from '../parts/common';

// ---------------------------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------------------------

const URGENCY_LABEL = { overdue: 'Overdue', today: 'Due today', soon: 'Due soon', done: 'Done', none: '' } as const;

function DateDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readDate(ctx.value);
  if (!value) return ctx.readOnly ? null : <EmptyGhost icon={<CalendarDays aria-hidden />} label="Set a date" />;
  const format = ((ctx.column.settings as { format?: DateDisplayFormat }).format ?? 'short') as DateDisplayFormat;
  const done = isItemDone(ctx.item, ctx.board?.columns ?? []);
  const urgency = dateUrgency(value.date, ctx.now, done);
  const text = formatDateValue(value, ctx.now, format);
  return (
    <span
      className={cn(
        'flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2',
        urgency === 'done' && 'text-fg-muted',
        urgency === 'overdue' && 'text-danger-text',
      )}
      data-urgency={urgency}
    >
      {urgency === 'overdue' ? <CircleAlert aria-hidden className="size-4 shrink-0 fill-[var(--danger)] text-[var(--surface-panel)]" /> : null}
      {urgency === 'done' ? (
        <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-white">
          <Check strokeWidth={3.5} className="size-2.5" />
        </span>
      ) : null}
      {urgency === 'today' || urgency === 'soon' ? <AlarmClock aria-hidden className="size-4 shrink-0 text-warning-text" /> : null}
      <TruncText className={cn(urgency === 'done' && 'line-through decoration-[1.5px]')}>{text}</TruncText>
      {urgency !== 'none' ? <span className="sr-only">{URGENCY_LABEL[urgency]}</span> : null}
    </span>
  );
}

interface QuickPick {
  readonly label: string;
  readonly offset: (today: Date) => Date;
}

const QUICK_PICKS: readonly QuickPick[] = [
  { label: 'Today', offset: (today) => today },
  { label: 'Tomorrow', offset: (today) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1) },
  { label: 'Next week', offset: (today) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((8 - today.getDay()) % 7 || 7)) },
  { label: 'In 2 weeks', offset: (today) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14) },
];

function DateEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const current = readDate(ctx.value);
  const settings = ctx.column.settings as { includeTime?: boolean };
  const [text, setText] = useState(ctx.seed ?? '');
  const [withTime, setWithTime] = useState(Boolean(current?.time) || settings.includeTime === true);
  const [time, setTime] = useState(current?.time ? formatTime(current.time) : '');
  const [timeError, setTimeError] = useState(false);
  const parsed = useMemo(() => (text.trim() ? parseDateInput(text, ctx.now) : null), [ctx.now, text]);
  const selected = parseIsoDate(current?.date);
  const today = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate());

  const save = (date: Date, close = true) => {
    const parsedTime = withTime && time.trim() ? parseTimeInput(time) : null;
    ctx.commit(parsedTime ? { date: toIsoDate(date), time: parsedTime } : { date: toIsoDate(date) });
    if (close) ctx.endEdit();
  };

  // Tab: save a typed date (or a changed time); an unreadable typed date keeps the picker open.
  useTabFlush(ctx, () => {
    if (text.trim()) {
      if (!parsed) return false;
      save(parsed, false);
      return true;
    }
    if (withTime && time.trim() && selected) {
      const value = parseTimeInput(time);
      if (!value) {
        setTimeError(true);
        return false;
      }
      if (value !== current?.time) ctx.commit({ date: toIsoDate(selected), time: value });
    }
    return true;
  });

  const onTextKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && parsed) {
      event.preventDefault();
      save(parsed);
    }
  };

  const onTimeCommit = () => {
    if (!time.trim()) return setTimeError(false);
    const value = parseTimeInput(time);
    setTimeError(value === null);
    if (value && selected) ctx.commit({ date: toIsoDate(selected), time: value });
  };

  return (
    <div className="flex w-[300px] flex-col gap-2" data-testid="date-picker">
      <div className="flex gap-2">
        <input
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onTextKey}
          placeholder={
            current
              ? `${(selected ?? today).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${current.time ? ` · ${formatTime(current.time)}` : ''}`
              : 'Type a date, e.g. next fri'
          }
          aria-label="Type a date"
          aria-invalid={text.trim() && !parsed ? true : undefined}
          className={cn(
            'h-8 min-w-0 flex-1 rounded-sm border border-border-input bg-panel px-2.5 text-base text-fg outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-input-hover focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
            text.trim() && !parsed && 'border-danger focus:border-danger',
            // The current value reads as the value (body color), not as a hint.
            current ? 'placeholder:text-fg' : 'placeholder:text-fg-muted',
          )}
        />
        <Button variant="secondary" size="md" onClick={() => save(today)}>
          Today
        </Button>
      </div>
      <p className={cn('-mt-1 h-4 px-0.5 text-xs', parsed ? 'text-primary-text' : 'text-danger-text')} aria-live="polite">
        {text.trim() ? (parsed ? `↵ ${parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}` : "Can't read that date") : ''}
      </p>
      <div className="flex flex-wrap gap-1">
        {QUICK_PICKS.slice(1).map((pick) => (
          <button
            key={pick.label}
            type="button"
            onClick={() => save(pick.offset(today))}
            className="h-6 rounded-full border border-border-default px-2.5 text-xs font-medium text-fg-secondary transition-colors duration-[var(--duration-instant)] hover:border-primary hover:bg-primary-subtle hover:text-primary-text focus-visible:outline-2 focus-visible:outline-focus active:bg-primary-selected"
          >
            {pick.label}
          </button>
        ))}
      </div>
      <div className="flex justify-center">
        <Calendar selected={selected ?? undefined} onSelect={(date) => (date ? save(date) : undefined)} />
      </div>
      <div className="-mx-3 -mb-3 flex items-center gap-2 border-t border-border-subtle px-3 py-2">
        <Switch checked={withTime} onCheckedChange={setWithTime} aria-label="Add time" size="sm" />
        <span className="text-sm text-fg-secondary">Time</span>
        {withTime ? (
          <span className="relative flex items-center">
            <Clock aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-icon" />
            <input
              value={time}
              onChange={(event) => setTime(event.target.value)}
              onBlur={onTimeCommit}
              onKeyDown={(event) => event.key === 'Enter' && onTimeCommit()}
              placeholder="9:00 AM"
              aria-label="Time"
              aria-invalid={timeError || undefined}
              className={cn('h-7 w-24 rounded-sm border border-border-input bg-panel pr-2 pl-7 text-sm text-fg outline-none focus:border-primary', timeError && 'border-danger')}
            />
          </span>
        ) : null}
        <span className="flex-1" />
        {current ? (
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={() => {
              ctx.commit(null);
              ctx.endEdit();
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------

function TimelineDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readTimeline(ctx.value);
  if (!value) return ctx.readOnly ? null : <EmptyGhost icon={<CalendarRange aria-hidden />} label="Set a timeline" />;
  const group = ctx.board?.groups?.find((entry) => entry.id === ctx.item.groupId);
  const color = toLabelColor(group?.color, 'blue');
  const progress = timelineProgress(value.from, value.to, ctx.now);
  const days = timelineDays(value.from, value.to);
  const range = formatTimelineRange(value.from, value.to, ctx.now);
  return (
    <Tooltip content={`${range} · ${formatDuration(days)}`} side="top" disabled={ctx.editing}>
      <span className="flex min-w-0 flex-1 items-center px-2" role="img" aria-label={`${range}, ${formatDuration(days)}`}>
        <span
          style={labelColorStyle(color)}
          className="relative flex h-[22px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--lc-bg)_40%,black)] text-sm font-medium text-white"
        >
          <span aria-hidden className="ks-bar-fill absolute inset-0 bg-[var(--lc-bg)]" style={{ transform: `scaleX(${progress})` }} />
          <span className="relative truncate px-2 group-hover/cell:hidden group-data-[force-hover=true]/cell:hidden">{range}</span>
          <span className="relative hidden truncate px-2 tabular-nums group-hover/cell:inline group-data-[force-hover=true]/cell:inline">
            {formatDuration(days)}
          </span>
        </span>
      </span>
    </Tooltip>
  );
}

const PRESETS: readonly { label: string; range: (today: Date) => [Date, Date] }[] = [
  { label: 'This week', range: (t) => [new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7)), new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7) + 4)] },
  { label: 'Next 2 weeks', range: (t) => [t, new Date(t.getFullYear(), t.getMonth(), t.getDate() + 13)] },
  { label: 'This month', range: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0)] },
  { label: 'This quarter', range: (t) => [new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1), new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3 + 3, 0)] },
];

function TimelineEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const current = readTimeline(ctx.value);
  const [range, setRange] = useState<DateRange | undefined>(() =>
    current ? { from: parseIsoDate(current.from) ?? undefined, to: parseIsoDate(current.to) ?? undefined } : undefined,
  );
  const today = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate());
  const from = range?.from;
  const to = range?.to ?? range?.from;
  const oneMonth = useMediaQuery(ONE_MONTH_QUERY);

  const save = (start: Date, end: Date) => {
    const [a, b] = start <= end ? [start, end] : [end, start];
    ctx.commit({ from: toIsoDate(a), to: toIsoDate(b) });
    ctx.endEdit();
  };

  return (
    // Presets and footer stay put; only the calendar body scrolls when space is short.
    <div className={cn('flex max-h-[inherit] max-w-full flex-col gap-2', oneMonth ? 'w-full' : 'w-[552px]')} data-testid="timeline-picker">
      <div className="flex flex-none flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              const [a, b] = preset.range(today);
              save(a, b);
            }}
            className="h-6 rounded-full border border-border-default px-2.5 text-xs font-medium text-fg-secondary transition-colors duration-[var(--duration-instant)] hover:border-primary hover:bg-primary-subtle hover:text-primary-text focus-visible:outline-2 focus-visible:outline-focus"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto">
        <RangeCalendar selected={range} onSelect={setRange} numberOfMonths={oneMonth ? 1 : 2} />
      </div>
      <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-none items-center gap-2 border-t border-border-subtle bg-[inherit] px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary" aria-live="polite">
          {from && to
            ? `${formatTimelineRange(toIsoDate(from <= to ? from : to), toIsoDate(from <= to ? to : from), ctx.now)} · ${formatDuration(timelineDays(toIsoDate(from <= to ? from : to), toIsoDate(from <= to ? to : from)) || 1)}`
            : 'Pick a start and end date'}
        </span>
        {current ? (
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={() => {
              ctx.commit(null);
              ctx.endEdit();
            }}
          >
            Clear
          </Button>
        ) : null}
        <Button size="sm" disabled={!from || !to} onClick={() => from && to && save(from, to)}>
          Save
        </Button>
      </div>
    </div>
  );
}

export const dateRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, typeToEdit: true, width: 300 },
  Display: DateDisplay,
  Editor: DateEditor,
};

export const timelineRenderer: CellRenderer = {
  // Two months side by side on desktop; narrow screens get one month in a bottom sheet.
  behavior: { mode: 'popover', clearable: true, width: 576 },
  Display: TimelineDisplay,
  Editor: TimelineEditor,
};
