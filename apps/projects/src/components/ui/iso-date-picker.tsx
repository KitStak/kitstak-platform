'use client';
import { DatePicker, type DatePickerProps } from './date-picker';

export interface IsoDatePickerProps extends Omit<DatePickerProps, 'value' | 'onChange'> {
  /** `YYYY-MM-DD` or null. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
}

function parse(value: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function format(date: Date | null): string | null {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** DatePicker for plain calendar dates (task start/due dates are `YYYY-MM-DD`, no time zone). */
export function IsoDatePicker({ value, onChange, ...props }: IsoDatePickerProps) {
  return <DatePicker {...props} value={parse(value)} onChange={(date) => onChange(format(date))} />;
}
