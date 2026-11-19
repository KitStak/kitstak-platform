'use client';
import { useMemo } from 'react';
import { DatePicker, type DatePickerProps, type QuickPick } from './date-picker';

export interface IsoDatePickerProps extends Omit<DatePickerProps, 'value' | 'onChange' | 'maxDate' | 'quickPicks'> {
  /** `YYYY-MM-DD` or null. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  /**
   * The last day that can be picked, `YYYY-MM-DD` (today at the site for work that was done). Later
   * days are greyed out and the shortcuts become Today and Yesterday, counted from this day.
   */
  readonly max?: string | null;
}

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function format(date: Date | null): string | null {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** DatePicker for plain calendar dates (task start/due dates are `YYYY-MM-DD`, no time zone). */
export function IsoDatePicker({ value, onChange, max, ...props }: IsoDatePickerProps) {
  const maxDate = useMemo(() => parse(max), [max]);
  const quickPicks = useMemo<readonly QuickPick[] | undefined>(() => {
    if (!maxDate) return undefined;
    const back = (days: number) => () => new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate() - days);
    return [
      { label: 'Today', date: back(0) },
      { label: 'Yesterday', date: back(1) },
    ];
  }, [maxDate]);
  return <DatePicker {...props} maxDate={maxDate ?? undefined} quickPicks={quickPicks} value={parse(value)} onChange={(date) => onChange(format(date))} />;
}
