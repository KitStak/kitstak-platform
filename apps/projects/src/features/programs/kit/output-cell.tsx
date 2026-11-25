'use client';
/**
 * OutputCell: the qty input used wherever people log output inline (log dialog, runs view, Floor
 * today, calendar popovers). Keys (docs/programs/SPEC.md 5.2): `=` fills the remaining qty,
 * `Enter` moves to the next row, `Shift Enter` to the previous row. Locked cells show a lock icon
 * with the reason instead of an input.
 */
import { forwardRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/components/ui';
import { LockIcon } from './chips';
import { readQty, remainingText } from './qty-input';

export interface OutputCellProps {
  /** What is typed now (plain text, may be empty). */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The accessible name, e.g. "Built today for Small Brown, GLOVE-212". */
  readonly label: string;
  /** Planned and built before today: `=` fills `planned - builtBefore`. */
  readonly planned?: string;
  readonly builtBefore?: string;
  readonly onEnter?: () => void;
  readonly onShiftEnter?: () => void;
  readonly onCommit?: (value: string) => void;
  /** When set, the day is locked and this is the reason. */
  readonly lockedReason?: string | null;
  readonly disabled?: boolean;
  readonly what?: 'qty' | 'scrap';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export const OutputCell = forwardRef<HTMLInputElement, OutputCellProps>(function OutputCell(
  { value, onChange, label, planned, builtBefore = '0', onEnter, onShiftEnter, onCommit, lockedReason, disabled, what = 'qty', size = 'md', className, 'data-testid': testId },
  ref,
) {
  const [touched, setTouched] = useState(false);
  const read = readQty(value, what);
  const error = touched && !read.ok ? read.message : null;

  if (lockedReason) {
    return (
      <span className={cn('inline-flex h-8 items-center justify-end gap-1.5 rounded-md bg-[repeating-linear-gradient(135deg,var(--surface-sunken)_0_4px,transparent_4px_8px)] px-2 text-sm text-fg-muted tabular-nums', className)} data-testid={testId}>
        <LockIcon reason={lockedReason} />
        {value || '0'}
      </span>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === '=' && planned !== undefined) {
      event.preventDefault();
      const fill = remainingText(planned, builtBefore);
      onChange(fill);
      onCommit?.(fill);
      return;
    }
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      setTouched(true);
      onCommit?.(value);
      if (event.shiftKey) onShiftEnter?.();
      else onEnter?.();
    }
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      aria-invalid={error ? true : undefined}
      title={error ?? undefined}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        setTouched(true);
        onCommit?.(value);
      }}
      data-testid={testId}
      className={cn(
        'w-full rounded-md border bg-panel text-right font-medium text-fg tabular-nums outline-none transition-[border-color,box-shadow] duration-[var(--duration-instant)]',
        'placeholder:text-fg-muted hover:border-border-input-hover focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
        'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-muted',
        size === 'sm' ? 'h-7 px-2 text-xs' : size === 'lg' ? 'h-12 px-3 text-2xl' : 'h-8 px-2 text-sm',
        error ? 'border-danger' : 'border-border-input',
        className,
      )}
    />
  );
});
