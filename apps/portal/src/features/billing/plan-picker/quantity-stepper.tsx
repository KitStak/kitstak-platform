'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/components/ui';

export interface QuantityStepperProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  /** 'plan-seats' gives plan-seats, plan-seats-inc and plan-seats-dec. */
  readonly testId: string;
  /** One unit, for the button labels: 'seat' or 'warehouse'. */
  readonly unit: string;
  readonly hint?: React.ReactNode;
  /** Shown instead of the hint when the person is at the lowest allowed value. */
  readonly floorHint?: string | null;
  readonly autoFocus?: boolean;
  readonly disabled?: boolean;
}

const BUTTON =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border-input bg-panel text-fg ' +
  'transition-colors duration-[var(--duration-fast)] hover:border-border-input-hover hover:bg-muted active:bg-pressed ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ' +
  'disabled:pointer-events-none disabled:opacity-[0.38]';

/** Minus, a number field, plus. 44 px buttons, arrow keys, typing, and a floor that says why. */
export function QuantityStepper({
  label,
  value,
  min,
  max,
  onChange,
  testId,
  unit,
  hint,
  floorHint,
  autoFocus = false,
  disabled = false,
}: QuantityStepperProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  // The text in the field while the person types. It may be empty or out of range for a moment.
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: false });
  }, [autoFocus]);

  const clamp = (next: number) => Math.min(Math.max(Math.round(next), min), max);
  const commit = (next: number) => {
    setDraft(null);
    const clamped = clamp(next);
    if (clamped !== value) onChange(clamped);
  };
  const atFloor = value <= min;
  const note = atFloor && floorHint ? floorHint : hint;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={BUTTON}
          aria-label={`Remove one ${unit}`}
          data-testid={`${testId}-dec`}
          disabled={disabled || atFloor}
          onClick={() => commit(value - 1)}
        >
          <Minus aria-hidden className="size-4" />
        </button>
        <input
          ref={inputRef}
          id={id}
          data-testid={testId}
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min={min}
          max={max}
          step={1}
          disabled={disabled}
          value={draft ?? String(value)}
          aria-describedby={note ? hintId : undefined}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            const parsed = Number(text);
            // Apply at once when the typed number is allowed, so the price follows every key.
            if (text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
              const whole = Math.round(parsed);
              if (whole !== value) onChange(whole);
            }
          }}
          onBlur={() => {
            if (draft === null) return;
            const parsed = Number(draft);
            commit(draft.trim() === '' || !Number.isFinite(parsed) ? value : parsed);
          }}
          className={cn(
            'h-11 w-20 rounded-lg border border-border-input bg-panel text-center text-md font-semibold text-fg tabular-nums',
            'hover:border-border-input-hover focus:field-focus',
            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
        <button
          type="button"
          className={BUTTON}
          aria-label={`Add one ${unit}`}
          data-testid={`${testId}-inc`}
          disabled={disabled || value >= max}
          onClick={() => commit(value + 1)}
        >
          <Plus aria-hidden className="size-4" />
        </button>
      </div>
      {note ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {note}
        </p>
      ) : null}
    </div>
  );
}
