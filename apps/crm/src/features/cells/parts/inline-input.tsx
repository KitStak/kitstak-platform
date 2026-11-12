'use client';
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { cn } from '@/components/ui';
import type { CellNavDirection } from '../types';

export interface InlineInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'defaultValue' | 'onSubmit'> {
  readonly initial: string;
  /** Called with the draft; return an error message to keep editing, or null to accept. */
  readonly validate?: (draft: string) => string | null;
  readonly onSubmit: (draft: string, navigate?: CellNavDirection) => void;
  readonly onCancel: () => void;
  readonly align?: 'start' | 'end';
  /** Called when blur happens with an invalid draft (the edit is discarded). */
  readonly onInvalidBlur?: (draft: string, message: string) => void;
  /** Focus on mount (default true; static previews pass false). */
  readonly grabFocus?: boolean;
}

/**
 * Text input rendered inside a cell. Enter saves (and moves down), Tab saves and moves
 * next/prev, Esc cancels, blur saves. Invalid drafts show a danger ring + helper text and are
 * never saved silently (CE-002).
 */
export function InlineInput({
  initial,
  validate,
  onSubmit,
  onCancel,
  align = 'start',
  onInvalidBlur,
  grabFocus = true,
  className,
  ...props
}: InlineInputProps) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const errorId = useId();

  useEffect(() => {
    const input = ref.current;
    if (!input || !grabFocus) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [grabFocus]);

  const finish = (navigate?: CellNavDirection) => {
    const message = validate?.(draft) ?? null;
    if (message) {
      setError(message);
      return false;
    }
    settled.current = true;
    onSubmit(draft, navigate);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish('down');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settled.current = true;
      onCancel();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      finish(event.shiftKey ? 'prev' : 'next');
    }
  };

  const onBlur = () => {
    if (settled.current) return;
    const message = validate?.(draft) ?? null;
    settled.current = true;
    if (message) {
      onInvalidBlur?.(draft, message);
      onCancel();
      return;
    }
    onSubmit(draft);
  };

  return (
    <div className="absolute inset-0 z-[2]">
      <input
        ref={ref}
        value={draft}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'size-full bg-panel px-2.5 text-base text-fg outline-none',
          'shadow-[inset_0_0_0_2px_var(--focus-ring)]',
          error && 'shadow-[inset_0_0_0_2px_var(--danger)]',
          align === 'end' && 'text-right tabular-nums',
          className,
        )}
        {...props}
      />
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="absolute top-full left-0 z-[var(--z-popover)] mt-1 max-w-[260px] rounded-sm border border-danger bg-raised px-2 py-1 text-xs font-medium text-danger-text shadow-popover"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
