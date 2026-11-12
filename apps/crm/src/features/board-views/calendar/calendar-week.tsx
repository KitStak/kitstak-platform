'use client';
import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Popover, PopoverAnchor, PopoverContent, cn } from '@/components/ui';
import { formatTime, layoutWeek, minutesOf, timeOf } from '../lib/calendar';
import { formatIso, type IsoDate } from '../lib/dates';
import type { CalendarGridCommon } from './calendar-month';
import { EventChip, QuickCreate } from './calendar-parts';

const HOUR_H = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function HourSlot({ day, hour, onCreate, canSchedule }: { readonly day: IsoDate; readonly hour: number; readonly onCreate: () => void; readonly canSchedule: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${day}:${hour}`, data: { date: day, minutes: hour * 60 } });
  return (
    <div
      ref={setNodeRef}
      onDoubleClick={() => canSchedule && onCreate()}
      className={cn('border-b border-border-subtle', isOver && 'bg-primary-subtle shadow-[inset_0_0_0_2px_var(--focus-ring)]')}
      style={{ height: HOUR_H }}
    />
  );
}

function AllDayCell({ day, height }: { readonly day: IsoDate; readonly height: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, data: { date: day } });
  return (
    <div ref={setNodeRef} style={{ height }} className={cn('border-l border-border-subtle', isOver && 'bg-primary-subtle shadow-[inset_0_0_0_2px_var(--focus-ring)]')} />
  );
}

export function CalendarWeek({
  days,
  common,
  eventDuration,
  timedEnabled,
}: {
  readonly days: readonly IsoDate[];
  readonly common: CalendarGridCommon;
  readonly eventDuration: number;
  /** Date columns support times; timeline columns are all-day only. */
  readonly timedEnabled: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState<{ day: IsoDate; minutes: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    scroller.current?.scrollTo({ top: HOUR_H * 7.5 });
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const allDay = common.events.filter((event) => !event.time || event.start !== event.end);
  const timed = common.events.filter((event) => event.time && event.start === event.end);
  const segments = layoutWeek(days, allDay);
  const slots = Math.max(1, ...segments.map((segment) => segment.slot + 1));
  const cols = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` };
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="calendar-week" role="grid" aria-label={days.length === 1 ? 'Day' : 'Week'}>
      <div role="row" className="grid shrink-0 border-b border-border-subtle bg-panel" style={cols}>
        <div />
        {days.map((day) => (
          <div role="columnheader" key={day} className="flex h-12 flex-col items-center justify-center border-l border-border-subtle">
            <span className="text-xs font-semibold text-fg-muted ">{formatIso(day, 'weekday')}</span>
            <span
              aria-current={day === common.today ? 'date' : undefined}
              className={cn('inline-flex size-7 items-center justify-center rounded-full text-md font-semibold tabular-nums', day === common.today ? 'bg-primary text-primary-fg' : 'text-fg')}
            >
              {Number(day.slice(8, 10))}
            </span>
          </div>
        ))}
      </div>
      <div className="relative grid shrink-0 border-b border-border-strong bg-panel" style={cols}>
        <div className="flex items-start justify-end px-2 pt-2 text-2xs font-semibold text-fg-muted ">All day</div>
        {days.map((day) => (
          <AllDayCell key={day} day={day} height={slots * 24 + 12} />
        ))}
        <div className="pointer-events-none absolute inset-0" style={{ left: 56 }}>
          {segments.map((segment) => (
            <EventChip
              key={segment.event.id}
              item={segment.event.item}
              start={segment.event.start}
              end={segment.event.end}
              look={common.look(segment.event.item)}
              draggable={common.canSchedule}
              onOpen={common.onOpen}
              continuesBefore={segment.continuesBefore}
              continuesAfter={segment.continuesAfter}
              className="pointer-events-auto absolute"
              style={{
                top: 8 + segment.slot * 24,
                left: `calc(${(segment.startCol / days.length) * 100}% + 4px)`,
                width: `calc(${(segment.span / days.length) * 100}% - 8px)`,
              }}
            />
          ))}
        </div>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto bg-panel">
        <div className="relative grid" style={cols}>
          <div>
            {HOURS.map((hour) => (
              <div key={hour} className="relative text-right" style={{ height: HOUR_H }}>
                {hour > 0 ? <span className="absolute -top-2 right-2 text-2xs text-fg-muted tabular-nums">{formatTime(timeOf(hour * 60))}</span> : null}
              </div>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} className="relative border-l border-border-subtle">
              {HOURS.map((hour) => (
                <Popover key={hour} open={creating?.day === day && creating.minutes === hour * 60} onOpenChange={(open) => setCreating(open ? { day, minutes: hour * 60 } : null)}>
                  <PopoverAnchor asChild>
                    <div>
                      <HourSlot day={day} hour={hour} canSchedule={common.canSchedule} onCreate={() => setCreating({ day, minutes: hour * 60 })} />
                    </div>
                  </PopoverAnchor>
                  <PopoverContent aria-label="Quick create">
                    <QuickCreate
                      date={day}
                      noun={common.noun}
                      onClose={() => setCreating(null)}
                      onCreate={(name) => common.onCreate(day, name, timedEnabled ? timeOf(hour * 60) : undefined)}
                    />
                  </PopoverContent>
                </Popover>
              ))}
              {timed
                .filter((event) => event.start === day)
                .map((event) => {
                  const start = minutesOf(event.time) ?? 0;
                  return (
                    <EventChip
                      key={event.id}
                      item={event.item}
                      start={event.start}
                      end={event.end}
                      time={event.time}
                      look={common.look(event.item)}
                      draggable={common.canSchedule}
                      onOpen={common.onOpen}
                      variant="block"
                      className="absolute right-1 left-1 z-[var(--z-raised)] flex-col"
                      style={{ top: (start / 60) * HOUR_H + 1, height: Math.max(22, (eventDuration / 60) * HOUR_H - 2) }}
                    />
                  );
                })}
              {day === common.today ? (
                <div aria-hidden className="pointer-events-none absolute right-0 left-0 z-[var(--z-sticky)] h-0.5 bg-danger" style={{ top: (nowMinutes / 60) * HOUR_H }}>
                  <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-danger" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
