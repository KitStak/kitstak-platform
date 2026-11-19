'use client';
import { useMemo } from 'react';
import { DatePicker, type DatePickerProps, type QuickPick } from './date-picker';

export interface IsoDatePickerProps extends Omit<DatePickerProps, 'value' | 'onChange' | 'maxDate' | 'minDate' | 'quickPicks'> {
  /** `YYYY-MM-DD` or null. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  /**
   * The last day that can be picked, `YYYY-MM-DD` (today at the site for work that was done). Later
   * days are greyed out and the shortcuts become Today and Yesterday, counted from this day.
   */
  readonly max?: string | null;
  /**
   * The first day that can be picked, `YYYY-MM-DD` (tomorrow at the site for a day to come back).
   * Earlier days are greyed out and the shortcuts are counted from this day.
   */
  readonly min?: string | null;
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
export function IsoDatePicker({ value, onChange, max, min, ...props }: IsoDatePickerProps) {
  const maxDate = useMemo(() => parse(max), [max]);
  const minDate = useMemo(() => parse(min), [min]);
  const quickPicks = useMemo<readonly QuickPick[] | undefined>(() => {
    if (minDate) {
      const ahead = (days: number) => () => new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate() + days);
      return [
        { label: 'Tomorrow', date: ahead(0) },
        { label: 'In a week', date: ahead(6) },
        { label: 'In 2 weeks', date: ahead(13) },
      ];
    }
    if (!maxDate) return undefined;
    const back = (days: number) => () => new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate() - days);
    return [
      { label: 'Today', date: back(0) },
      { label: 'Yesterday', date: back(1) },
    ];
  }, [maxDate, minDate]);
  return <DatePicker {...props} maxDate={maxDate ?? undefined} minDate={minDate ?? undefined} quickPicks={quickPicks} value={parse(value)} onChange={(date) => onChange(format(date))} />;
}
