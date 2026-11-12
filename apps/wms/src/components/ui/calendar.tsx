'use client';

import * as React from 'react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** react-day-picker styled with KitStaks tokens (no library stylesheet needed). */
export function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays
      weekStartsOn={0}
      className={cn('text-xs', className)}
      classNames={{
        root: 'relative',
        months: 'flex gap-4',
        month: 'flex flex-col gap-2',
        month_caption: 'flex h-7 items-center justify-center text-sm font-semibold text-foreground',
        caption_label: '',
        nav: 'absolute inset-x-0 top-0 flex h-7 items-center justify-between',
        button_previous:
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-secondary hover:bg-neutral-soft hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 disabled:opacity-40',
        button_next:
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-secondary hover:bg-neutral-soft hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 disabled:opacity-40',
        month_grid: 'border-collapse',
        weekdays: 'flex',
        weekday: 'w-8 pb-1 text-center text-2xs font-medium text-faint',
        week: 'mt-0.5 flex',
        day: 'relative h-8 w-8 p-0 text-center',
        day_button:
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-xs tabular-nums text-body transition-colors hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/35',
        selected: '[&>button]:bg-primary [&>button]:text-white [&>button]:hover:bg-primary-hover',
        today: '[&>button]:font-semibold [&>button]:text-primary',
        outside: '[&>button]:text-faint',
        disabled:
          '[&>button]:cursor-not-allowed [&>button]:text-faint [&>button]:opacity-50 [&>button]:hover:bg-transparent',
        range_middle:
          'bg-primary-soft [&>button]:bg-transparent [&>button]:text-primary [&>button]:hover:bg-primary-soft first:rounded-l-md last:rounded-r-md',
        range_start: 'rounded-l-md bg-primary-soft',
        range_end: 'rounded-r-md bg-primary-soft',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden />
          ),
      }}
      {...props}
    />
  );
}
