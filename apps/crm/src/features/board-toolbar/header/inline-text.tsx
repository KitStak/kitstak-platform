'use client';

/**
 * Click-to-edit text that keeps the same box in view and edit mode (0px layout shift, BT-001).
 * Enter / blur saves, Esc cancels and returns focus to the trigger.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/components/ui';

export interface InlineTextProps {
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly editing: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  readonly maxLength?: number;
  /** Classes for both the view box and the input (typography + box). */
  readonly className?: string;
  /** Rendered in view mode instead of `value` (e.g. a ghost "Add description"). */
  readonly display?: ReactNode;
  readonly testId?: string;
  /** Empty values are not allowed (board name). */
  readonly required?: boolean;
}

export function InlineText({
  value,
  onCommit,
  label,
  placeholder,
  disabled,
  editing,
  onEditingChange,
  maxLength = 255,
  className,
  display,
  testId,
  required,
}: InlineTextProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  const [wasEditing, setWasEditing] = useState(false);
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) setDraft(value);
  }

  useEffect(() => {
    if (!editing) return;
    cancelled.current = false;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const finish = (save: boolean) => {
    const next = draft.trim();
    if (save && !(required && !next) && next !== value) onCommit(next);
    onEditingChange(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelled.current = true;
      finish(false);
    }
  };

  const box =
    'min-w-0 rounded-sm border border-transparent px-1.5 -mx-1.5 outline-none transition-[border-color,background-color] duration-[var(--duration-instant)] ease-out';

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={label}
        data-testid={testId ? `${testId}-input` : undefined}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!cancelled.current) finish(true);
        }}
        size={Math.max(8, Math.min(60, draft.length + 1))}
        className={cn(box, 'border-primary bg-panel text-fg', className)}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      data-testid={testId}
      aria-label={disabled ? undefined : `${label}: ${value || placeholder || ''}. Click to edit`}
      onClick={() => onEditingChange(true)}
      title={value || undefined}
      className={cn(
        box,
        'truncate text-left',
        !disabled && 'cursor-text hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-default',
        className,
      )}
    >
      {display ?? value}
    </button>
  );
}
