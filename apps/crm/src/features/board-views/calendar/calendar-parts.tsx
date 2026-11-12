'use client';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CalendarClock, GripVertical, X } from 'lucide-react';
import { Button, IconButton, Input, Tooltip, cn, labelColorStyle, type LabelColor } from '@/components/ui';
import type { ItemDto } from '@/server/services/contracts/dto';
import { formatTime } from '../lib/calendar';
import { formatIso, formatSpan, type IsoDate } from '../lib/dates';

export interface EventLook {
  readonly color: LabelColor;
  readonly label: string | null;
  readonly groupTitle: string | null;
}

export interface EventChipProps {
  readonly item: ItemDto;
  readonly start: IsoDate;
  readonly end: IsoDate;
  readonly time?: string;
  readonly look: EventLook;
  readonly draggable: boolean;
  readonly onOpen: (itemId: string) => void;
  readonly continuesBefore?: boolean;
  readonly continuesAfter?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly variant?: 'chip' | 'block';
  /** Unique drag id when the same item renders more than once (week segments). */
  readonly dragKey?: string;
}

function EventTooltip({ item, start, end, time, look }: Pick<EventChipProps, 'item' | 'start' | 'end' | 'time' | 'look'>) {
  return (
    <div className="flex max-w-64 flex-col gap-1 py-0.5">
      <span className="font-semibold">{item.name}</span>
      <span className="opacity-80">
        {start === end ? formatIso(start, 'full') : formatSpan(start, end)}
        {time ? ` · ${formatTime(time)}` : ''}
      </span>
      {look.groupTitle ? <span className="opacity-80">{look.groupTitle}</span> : null}
      {look.label ? (
        <span style={labelColorStyle(look.color)} className="mt-0.5 inline-flex h-5 w-fit items-center rounded-sm bg-[var(--lc-bg)] px-2 text-xs font-medium text-[var(--lc-fg)]">
          {look.label}
        </span>
      ) : null}
    </div>
  );
}

export function EventChip({
  item,
  start,
  end,
  time,
  look,
  draggable,
  onOpen,
  continuesBefore,
  continuesAfter,
  className,
  style,
  variant = 'chip',
  dragKey,
}: EventChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragKey ?? `event:${item.id}`,
    data: { itemId: item.id, start, end },
    disabled: !draggable,
  });
  return (
    <Tooltip content={<EventTooltip item={item} start={start} end={end} time={time} look={look} />} delayDuration={350}>
      <button
        ref={setNodeRef}
        type="button"
        data-testid="calendar-event"
        data-item-id={item.id}
        {...attributes}
        {...listeners}
        aria-label={`${item.name}, ${start === end ? formatIso(start, 'full') : formatSpan(start, end)}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(item.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onOpen(item.id);
            return;
          }
          listeners?.onKeyDown?.(event);
        }}
        style={{ ...labelColorStyle(look.color), ...style }}
        className={cn(
          'flex min-w-0 items-center gap-1 overflow-hidden bg-[var(--lc-bg)] px-1.5 text-left text-xs font-medium text-[var(--lc-fg)]',
          'transition-[filter,box-shadow,opacity] duration-[var(--duration-fast)] ease-out hover:brightness-95 hover:shadow-sm active:brightness-90',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          variant === 'chip' ? 'h-[22px] rounded-sm' : 'items-start rounded-md py-1',
          continuesBefore && 'rounded-l-none',
          continuesAfter && 'rounded-r-none',
          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          isDragging && 'opacity-40',
          className,
        )}
      >
        {time && variant === 'chip' ? <span className="shrink-0 opacity-85 tabular-nums">{formatTime(time)}</span> : null}
        <span className="truncate">{item.name}</span>
      </button>
    </Tooltip>
  );
}

/** Ghost shown under the pointer while dragging an event. */
export function EventGhost({ item, look }: { readonly item: ItemDto; readonly look: EventLook }) {
  return (
    <div
      style={labelColorStyle(look.color)}
      className="flex h-[22px] w-44 items-center rounded-sm bg-[var(--lc-bg)] px-2 text-xs font-medium text-[var(--lc-fg)] opacity-95 shadow-lg rotate-1 motion-reduce:rotate-0"
    >
      <span className="truncate">{item.name}</span>
    </div>
  );
}

export function QuickCreate({
  date,
  noun,
  onCreate,
  onClose,
}: {
  readonly date: IsoDate;
  readonly noun: string;
  readonly onCreate: (name: string) => void;
  readonly onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = () => {
    if (!value.trim()) return;
    onCreate(value.trim());
    setValue('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div className="flex w-64 flex-col gap-2" data-testid="calendar-quick-create">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-fg">New {noun.toLowerCase()} · {formatIso(date, 'full')}</span>
        <IconButton size="xs" label="Close" icon={<X aria-hidden />} onClick={onClose} />
      </div>
      <Input ref={ref} size="sm" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown} placeholder={`${noun} name`} aria-label={`${noun} name`} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={!value.trim()}>
          Create
        </Button>
      </div>
    </div>
  );
}

function TrayItem({ item, look, onOpen, draggable }: { readonly item: ItemDto; readonly look: EventLook; readonly onOpen: (id: string) => void; readonly draggable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `event:${item.id}`, data: { itemId: item.id, unscheduled: true }, disabled: !draggable });
  return (
    <li>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onOpen(item.id);
          listeners?.onKeyDown?.(event);
        }}
        aria-label={`${item.name}, not scheduled. Space to pick up, arrows to move, Space to drop.`}
        className={cn(
          'group flex h-9 cursor-grab items-center gap-2 rounded-md border border-border-subtle bg-panel px-2 text-sm text-fg shadow-xs',
          'transition-[box-shadow,border-color] duration-[var(--duration-fast)] hover:border-border-default hover:shadow-sm focus-visible:outline-2 focus-visible:outline-focus',
          isDragging && 'opacity-40',
        )}
        style={labelColorStyle(look.color)}
        data-testid="unscheduled-item"
      >
        <GripVertical aria-hidden className="size-3.5 shrink-0 text-icon" />
        <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[var(--lc-bg)]" />
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          onPointerDown={(event) => event.stopPropagation()}
          className="min-w-0 flex-1 truncate text-left hover:underline focus-visible:outline-none"
          tabIndex={-1}
        >
          {item.name}
        </button>
      </div>
    </li>
  );
}

export function UnscheduledTray({
  items,
  looks,
  noun,
  onOpen,
  onClose,
  draggable,
  footer,
}: {
  readonly items: readonly ItemDto[];
  readonly looks: (item: ItemDto) => EventLook;
  readonly noun: string;
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
  readonly draggable: boolean;
  readonly footer?: ReactNode;
}) {
  return (
    <aside
      aria-label="Unscheduled"
      data-testid="unscheduled-tray"
      className="flex w-64 shrink-0 flex-col border-l border-border-subtle bg-panel animate-slide-in-right motion-reduce:animate-none max-[768px]:absolute max-[768px]:inset-y-0 max-[768px]:right-0 max-[768px]:z-[var(--z-sticky)] max-[768px]:shadow-lg"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <CalendarClock aria-hidden className="size-4 text-icon" />
        <h3 className="flex-1 text-sm font-semibold text-fg">
          Unscheduled <span className="font-normal text-fg-muted tabular-nums">({items.length})</span>
        </h3>
        <IconButton size="xs" label="Close unscheduled" icon={<X aria-hidden />} onClick={onClose} />
      </div>
      <p className="px-3 pt-2 text-xs text-fg-muted">Drag onto a day to schedule.</p>
      {items.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-fg-muted">Every {noun.toLowerCase()} has a date.</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
          {items.map((item) => (
            <TrayItem key={item.id} item={item} look={looks(item)} onOpen={onOpen} draggable={draggable} />
          ))}
        </ul>
      )}
      {footer}
    </aside>
  );
}
