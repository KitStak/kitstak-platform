'use client';
import { useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { addDays, format, isValid, nextMonday, startOfToday } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from './cn';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type { DateRange };

/** Shared DayPicker theming: tokens drive every color; layout via our utility classes. */
const dayPickerClassNames = {
  root: 'ks-day-picker text-base',
  months: 'relative flex flex-wrap gap-6',
  month_caption: 'flex h-8 items-center px-1 text-base font-semibold',
  nav: 'absolute top-0 right-0 flex items-center gap-0.5',
  button_previous:
    'inline-flex size-8 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong disabled:opacity-40',
  button_next:
    'inline-flex size-8 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong disabled:opacity-40',
  weekday: 'h-8 w-9 text-xs font-semibold text-fg-muted',
  /** No cell spacing so a selected range reads as one continuous band. */
  month_grid: 'border-collapse',
  day: 'p-0 text-center',
  day_button:
    'inline-flex size-9 items-center justify-center rounded-sm text-base text-fg transition-colors duration-[var(--duration-instant)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus',
  today: 'font-bold text-primary-text',
  selected: '[&>button]:bg-primary [&>button]:text-primary-fg [&>button]:hover:bg-primary-hover',
  range_middle: '[&>button]:!bg-primary-selected [&>button]:!text-fg [&>button]:rounded-none rounded-none',
  /** Endpoints win over the outside-day dimming so both ends of a range look identical. */
  range_start: '[&>button]:rounded-r-none !opacity-100 [&>button]:!bg-primary [&>button]:!text-primary-fg',
  range_end: '[&>button]:rounded-l-none !opacity-100 [&>button]:!bg-primary [&>button]:!text-primary-fg',
  outside: 'text-fg-muted opacity-60',
  disabled: 'opacity-35 [&>button]:cursor-not-allowed',
} as const;

const components = {
  Chevron: ({ orientation }: { orientation?: 'left' | 'right' | 'up' | 'down' }) =>
    orientation === 'left' ? <ChevronLeft aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />,
};

export interface CalendarProps {
  readonly selected: Date | undefined;
  readonly onSelect: (date: Date | undefined) => void;
  readonly weekStartsOn?: 0 | 1;
}

/** Inline single-date calendar. */
export function Calendar({ selected, onSelect, weekStartsOn = 0 }: CalendarProps) {
  return (
    <DayPicker
      mode="single"
      selected={selected}
      onSelect={onSelect}
      defaultMonth={selected}
      weekStartsOn={weekStartsOn}
      showOutsideDays
      fixedWeeks
      classNames={dayPickerClassNames}
      components={components}
    />
  );
}

export interface RangeCalendarProps {
  readonly selected: DateRange | undefined;
  readonly onSelect: (range: DateRange | undefined) => void;
  readonly numberOfMonths?: number;
}

export function RangeCalendar({ selected, onSelect, numberOfMonths = 2 }: RangeCalendarProps) {
  return (
    <DayPicker
      mode="range"
      selected={selected}
      onSelect={onSelect}
      defaultMonth={selected?.from}
      numberOfMonths={numberOfMonths}
      showOutsideDays
      classNames={dayPickerClassNames}
      components={components}
    />
  );
}

export interface DatePickerProps {
  readonly value: Date | null;
  readonly onChange: (date: Date | null) => void;
  readonly placeholder?: string;
  readonly displayFormat?: string;
  readonly disabled?: boolean;
  readonly clearable?: boolean;
  readonly id?: string;
  readonly 'aria-label'?: string;
  readonly className?: string;
}

interface QuickPick {
  readonly label: string;
  readonly date: () => Date;
}

const QUICK_PICKS: readonly QuickPick[] = [
  { label: 'Today', date: () => startOfToday() },
  { label: 'Tomorrow', date: () => addDays(startOfToday(), 1) },
  { label: 'Next week', date: () => nextMonday(startOfToday()) },
  { label: 'In 2 weeks', date: () => addDays(startOfToday(), 14) },
];

/** Field-style trigger with a calendar popover and quick picks. */
export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  displayFormat = 'MMM d, yyyy',
  disabled,
  clearable = true,
  id,
  className,
  ...aria
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const valid = value && isValid(value) ? value : null;
  const choose = (date: Date | null) => {
    onChange(date);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative w-full', className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            aria-label={aria['aria-label']}
            disabled={disabled}
            className={cn(
              'inline-flex h-8 w-full items-center gap-2 rounded-md border border-border-input bg-panel px-2.5 text-left text-sm',
              'transition-[border-color,box-shadow] duration-[var(--duration-fast)] outline-none hover:border-border-input-hover',
              'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--focus-ring-soft)] data-[state=open]:border-primary',
              'disabled:cursor-not-allowed disabled:opacity-60',
              valid ? 'text-fg' : 'text-fg-placeholder',
              clearable && valid && 'pr-8',
            )}
          >
            <CalendarDays aria-hidden className="size-4 shrink-0 text-icon" />
            <span className="truncate">{valid ? format(valid, displayFormat) : placeholder}</span>
          </button>
        </PopoverTrigger>
        {clearable && valid && !disabled ? (
          <button
            type="button"
            aria-label="Clear date"
            onClick={() => onChange(null)}
            className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-xs text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </div>
      <PopoverContent flush className="flex">
        <div className="flex w-32 flex-col gap-0.5 border-r border-border-subtle p-2">
          {QUICK_PICKS.map((pick) => (
            <Button key={pick.label} variant="ghost" size="sm" className="justify-start" onClick={() => choose(pick.date())}>
              {pick.label}
            </Button>
          ))}
          {valid ? (
            <Button variant="danger-ghost" size="sm" className="mt-auto justify-start" onClick={() => choose(null)}>
              Clear
            </Button>
          ) : null}
        </div>
        <div className="p-3">
          <Calendar selected={valid ?? undefined} onSelect={(date) => choose(date ?? null)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
