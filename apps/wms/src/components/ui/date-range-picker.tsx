'use client';

import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { DateRange as DayPickerRange } from 'react-day-picker';
import { CalendarRange, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { INPUT_DATE_FORMAT, formatPattern } from '@/lib/format';
import { Button } from './button';
import { Calendar } from './calendar';
import { controlVariants, panelClass, type ControlSize } from './control-styles';

export interface DateRangeValue {
  readonly from: Date | null;
  readonly to: Date | null;
}

export interface DateRangePreset {
  readonly key: string;
  readonly label: string;
  readonly range: (now: Date) => DateRangeValue;
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const daysAgo = (now: Date, n: number): Date =>
  startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

/** Mirrors the grid grammar's date presets (BUILD_PLAN 0.2). */
export const DEFAULT_RANGE_PRESETS: readonly DateRangePreset[] = [
  { key: 'today', label: 'Today', range: (now) => ({ from: startOfDay(now), to: endOfDay(now) }) },
  { key: 'last3d', label: 'Last 3 days', range: (now) => ({ from: daysAgo(now, 2), to: endOfDay(now) }) },
  { key: 'last7d', label: 'Last 7 days', range: (now) => ({ from: daysAgo(now, 6), to: endOfDay(now) }) },
  { key: 'last30d', label: 'Last 30 days', range: (now) => ({ from: daysAgo(now, 29), to: endOfDay(now) }) },
  { key: 'last90d', label: 'Last 90 days', range: (now) => ({ from: daysAgo(now, 89), to: endOfDay(now) }) },
  {
    key: 'last12m',
    label: 'Last 12 months',
    range: (now) => ({
      from: startOfDay(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1)),
      to: endOfDay(now),
    }),
  },
];

export function formatRange(value: DateRangeValue): string {
  if (!value.from && !value.to) return '';
  const from = value.from ? formatPattern(value.from, INPUT_DATE_FORMAT) : '…';
  const to = value.to ? formatPattern(value.to, INPUT_DATE_FORMAT) : '…';
  return `${from} – ${to}`;
}

export interface DateRangePickerProps {
  readonly value: DateRangeValue;
  readonly onChange: (value: DateRangeValue, presetKey: string | null) => void;
  readonly presets?: readonly DateRangePreset[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly size?: ControlSize;
  readonly id?: string;
  readonly className?: string;
  readonly 'aria-label'?: string;
}

export function DateRangePicker({
  value,
  onChange,
  presets = DEFAULT_RANGE_PRESETS,
  placeholder = 'Select date range',
  disabled,
  invalid,
  size = 'md',
  id,
  className,
  ...aria
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DateRangeValue>(value);
  const [presetKey, setPresetKey] = React.useState<string | null>(null);
  const label = formatRange(value);

  const openChange = (next: boolean) => {
    if (next) {
      setDraft(value);
      setPresetKey(null);
    }
    setOpen(next);
  };

  const apply = () => {
    onChange(
      {
        from: draft.from ? startOfDay(draft.from) : null,
        to: draft.to ? endOfDay(draft.to) : draft.from ? endOfDay(draft.from) : null,
      },
      presetKey,
    );
    setOpen(false);
  };

  return (
    <PopoverPrimitive.Root open={open && !disabled} onOpenChange={openChange}>
      <div className={cn('relative w-full', className)}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            data-invalid={invalid || undefined}
            aria-label={aria['aria-label']}
            className={cn(
              controlVariants({ size }),
              'flex items-center gap-2 text-left',
              label ? 'pr-8' : null,
              !label && 'text-faint',
            )}
          >
            <CalendarRange className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden />
            <span className="truncate tabular-nums">{label || placeholder}</span>
          </button>
        </PopoverPrimitive.Trigger>
        {label && !disabled ? (
          <button
            type="button"
            aria-label="Clear date range"
            onClick={() => onChange({ from: null, to: null }, null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:bg-neutral-soft hover:text-body"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cn(panelClass, 'flex flex-col p-0 sm:flex-row')}
        >
          <div className="flex flex-row flex-wrap gap-0.5 border-b border-border p-2 sm:w-[150px] sm:flex-col sm:border-b-0 sm:border-r">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => {
                  setDraft(preset.range(new Date()));
                  setPresetKey(preset.key);
                }}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30',
                  presetKey === preset.key ? 'bg-primary-soft font-semibold text-primary' : 'text-body',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="p-3">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={{ from: draft.from ?? undefined, to: draft.to ?? undefined }}
              defaultMonth={draft.from ?? undefined}
              onSelect={(range: DayPickerRange | undefined) => {
                setDraft({ from: range?.from ?? null, to: range?.to ?? null });
                setPresetKey(null);
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
              <span className="text-xs tabular-nums text-secondary">
                {formatRange(draft) || 'No range selected'}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft({ from: null, to: null })}>
                  Clear
                </Button>
                <Button size="sm" variant="primary" onClick={apply}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
