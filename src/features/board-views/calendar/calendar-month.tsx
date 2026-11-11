'use client';
import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent, cn } from '@/components/ui';
import type { ItemDto } from '@/server/services/contracts/dto';
import { eventsOnDay, layoutWeek, overflowByDay, type CalendarEvent } from '../lib/calendar';
import { formatIso, isSameMonth, type IsoDate } from '../lib/dates';
import { EventChip, QuickCreate, type EventLook } from './calendar-parts';

const HEADER_H = 30;
const SLOT_H = 24;
const MAX_SLOTS = 3;

export interface CalendarGridCommon {
  readonly events: readonly CalendarEvent[];
  readonly look: (item: ItemDto) => EventLook;
  readonly today: IsoDate;
  readonly noun: string;
  readonly canSchedule: boolean;
  readonly onOpen: (itemId: string) => void;
  readonly onCreate: (date: IsoDate, name: string, time?: string) => void;
}

function DayCell({
  day,
  anchor,
  today,
  hidden,
  dayEvents,
  common,
  creating,
  onCreating,
}: {
  readonly day: IsoDate;
  readonly anchor: IsoDate;
  readonly today: IsoDate;
  readonly hidden: number;
  readonly dayEvents: readonly CalendarEvent[];
  readonly common: CalendarGridCommon;
  readonly creating: boolean;
  readonly onCreating: (open: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, data: { date: day } });
  const [moreOpen, setMoreOpen] = useState(false);
  const outside = !isSameMonth(day, anchor);
  const isToday = day === today;
  return (
    <Popover open={creating} onOpenChange={onCreating}>
      <PopoverAnchor asChild>
        <div
          ref={setNodeRef}
          role="gridcell"
          aria-label={`${formatIso(day, 'weekdayLong')}${dayEvents.length ? `, ${dayEvents.length} scheduled` : ''}`}
          data-testid="calendar-day"
          data-date={day}
          onDoubleClick={() => common.canSchedule && onCreating(true)}
          className={cn(
            'group/day relative min-w-0 border-r border-b border-border-subtle transition-colors duration-[var(--duration-fast)]',
            outside ? 'bg-sunken' : 'bg-panel',
            isOver && 'bg-primary-subtle shadow-[inset_0_0_0_2px_var(--focus-ring)]',
          )}
        >
          <div className="flex h-[30px] items-center justify-between px-1.5">
            <span
              className={cn(
                'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-medium whitespace-nowrap tabular-nums',
                isToday ? 'bg-primary font-semibold text-primary-fg' : outside ? 'text-fg-muted' : 'text-fg-secondary',
              )}
              aria-current={isToday ? 'date' : undefined}
            >
              {Number(day.slice(8, 10)) === 1 ? `${formatIso(day, 'monthShort')} 1` : Number(day.slice(8, 10))}
            </span>
            {common.canSchedule ? (
              <button
                type="button"
                aria-label={`New ${common.noun.toLowerCase()} on ${formatIso(day, 'full')}`}
                onClick={() => onCreating(true)}
                className="inline-flex size-6 items-center justify-center rounded-sm text-icon opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/day:opacity-100 hover:bg-hover hover:text-icon-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus max-[768px]:hidden"
              >
                <Plus aria-hidden className="size-3.5" />
              </button>
            ) : null}
          </div>
          {hidden > 0 ? (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverAnchor asChild>
                <button
                  type="button"
                  data-testid="calendar-more"
                  onClick={() => setMoreOpen(true)}
                  style={{ top: HEADER_H + MAX_SLOTS * SLOT_H }}
                  className="absolute right-1 left-1 z-[var(--z-raised)] flex h-[22px] items-center rounded-sm px-1.5 text-xs font-semibold text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
                >
                  +{hidden} more
                </button>
              </PopoverAnchor>
              <PopoverContent className="w-64" aria-label={`Everything on ${formatIso(day, 'full')}`}>
                <h4 className="mb-2 text-sm font-semibold text-fg">{formatIso(day, 'weekdayLong')}</h4>
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {dayEvents.map((event) => (
                    <li key={event.id}>
                      <EventChip
                        item={event.item}
                        start={event.start}
                        end={event.end}
                        time={event.time}
                        look={common.look(event.item)}
                        draggable={false}
                        onOpen={(id) => {
                          setMoreOpen(false);
                          common.onOpen(id);
                        }}
                        className="w-full"
                      />
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent aria-label="Quick create">
        <QuickCreate date={day} noun={common.noun} onClose={() => onCreating(false)} onCreate={(name) => common.onCreate(day, name)} />
      </PopoverContent>
    </Popover>
  );
}

export function CalendarMonth({
  weeks,
  anchor,
  weekdayLabels,
  common,
}: {
  readonly weeks: readonly (readonly IsoDate[])[];
  readonly anchor: IsoDate;
  readonly weekdayLabels: readonly string[];
  readonly common: CalendarGridCommon;
}) {
  const [creating, setCreating] = useState<IsoDate | null>(null);
  const columns = weeks[0]?.length ?? 7;
  return (
    <div role="grid" aria-label="Month" className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="calendar-month">
      <div role="row" className="sticky top-0 z-[var(--z-sticky)] grid shrink-0 border-b border-border-subtle bg-panel" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {weekdayLabels.map((label) => (
          <div role="columnheader" key={label} className="h-8 px-2 text-xs leading-8 font-semibold text-fg-muted ">
            {label}
          </div>
        ))}
      </div>
      {weeks.map((days) => {
        const segments = layoutWeek(days, common.events);
        const hidden = overflowByDay(segments, days.length, MAX_SLOTS);
        return (
          <div
            role="row"
            key={days[0]}
            className="relative grid min-h-[132px] flex-1 border-l border-border-subtle"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {days.map((day, index) => (
              <DayCell
                key={day}
                day={day}
                anchor={anchor}
                today={common.today}
                hidden={(hidden[index] ?? 0) > 0 ? eventsOnDay(common.events, day).length - MAX_SLOTS + 1 : 0}
                dayEvents={eventsOnDay(common.events, day)}
                common={common}
                creating={creating === day}
                onCreating={(open) => setCreating(open ? day : null)}
              />
            ))}
            {segments
              .filter((segment) => segment.slot < MAX_SLOTS && !(segment.slot === MAX_SLOTS - 1 && hiddenInRange(hidden, segment.startCol, segment.span)))
              .map((segment) => (
                <EventChip
                  key={`${segment.event.id}-${days[0]}`}
                  dragKey={`event:${segment.event.id}:${days[0]}`}
                  item={segment.event.item}
                  start={segment.event.start}
                  end={segment.event.end}
                  time={segment.event.time}
                  look={common.look(segment.event.item)}
                  draggable={common.canSchedule}
                  onOpen={common.onOpen}
                  continuesBefore={segment.continuesBefore}
                  continuesAfter={segment.continuesAfter}
                  className="absolute z-[var(--z-raised)]"
                  style={{
                    top: HEADER_H + segment.slot * SLOT_H,
                    left: `calc(${(segment.startCol / columns) * 100}% + 4px)`,
                    width: `calc(${(segment.span / columns) * 100}% - 8px)`,
                  }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function hiddenInRange(hidden: readonly number[], start: number, span: number): boolean {
  for (let col = start; col < start + span; col += 1) if ((hidden[col] ?? 0) > 0) return true;
  return false;
}
