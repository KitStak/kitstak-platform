'use client';

import * as React from 'react';
import { Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { controlVariants, type ControlSize } from './control-styles';

export const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Normalises "9:5"/"0905"/"09:05" → "09:05"; null when invalid. */
export function normalizeTime(text: string): string | null {
  const raw = text.trim();
  const compact = /^\d{3,4}$/.test(raw) ? `${raw.slice(0, raw.length - 2)}:${raw.slice(-2)}` : raw;
  const m = TIME_RE.exec(compact);
  if (!m) return null;
  return `${(m[1] ?? '0').padStart(2, '0')}:${m[2]}`;
}

export interface TimePickerProps {
  /** "HH:mm" (24h) or null. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly clearable?: boolean;
  readonly size?: ControlSize;
  readonly id?: string;
  readonly className?: string;
  readonly placeholder?: string;
  readonly onBlur?: () => void;
  readonly 'aria-label'?: string;
  readonly 'aria-describedby'?: string;
}

/** 24h time field (`HH:mm`). Accepts "930" or "9:30"; reverts invalid text on blur. */
export const TimePicker = React.forwardRef<HTMLInputElement, TimePickerProps>(
  (
    {
      value,
      onChange,
      disabled,
      invalid,
      clearable = true,
      size = 'md',
      id,
      className,
      placeholder = 'HH:mm',
      onBlur,
      ...aria
    },
    ref,
  ) => {
    const [text, setText] = React.useState<string | null>(null);
    const shown = text ?? value ?? '';
    const bad = text !== null && text.trim() !== '' && normalizeTime(text) === null;
    const commit = () => {
      if (text === null) return;
      const trimmed = text.trim();
      setText(null);
      if (!trimmed) {
        if (value !== null) onChange(null);
        return;
      }
      const next = normalizeTime(trimmed);
      if (next && next !== value) onChange(next);
    };
    return (
      <div
        data-invalid={invalid || bad || undefined}
        data-disabled={disabled || undefined}
        className={cn(controlVariants({ size }), 'flex items-center gap-1.5', className)}
      >
        <Clock className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
        <input
          ref={ref}
          id={id}
          value={shown}
          disabled={disabled}
          placeholder={placeholder}
          inputMode="numeric"
          autoComplete="off"
          maxLength={5}
          aria-invalid={invalid || bad || undefined}
          aria-label={aria['aria-label']}
          aria-describedby={aria['aria-describedby']}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            commit();
            onBlur?.();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          className="h-full w-full min-w-0 bg-transparent tabular-nums outline-none placeholder:text-faint disabled:cursor-not-allowed"
        />
        {clearable && value && !disabled ? (
          <button
            type="button"
            aria-label="Clear time"
            onClick={() => onChange(null)}
            className="rounded p-0.5 text-faint hover:bg-neutral-soft hover:text-body"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    );
  },
);
TimePicker.displayName = 'TimePicker';
