'use client';
/**
 * The 6 digit code field (docs/billing/SPEC.md section 5.4): one real input, so the phone's "from
 * Messages" and mail autofill, password managers and paste all work. Six boxes are drawn behind it
 * to show how many digits are left. Pasting "123 456" or "Code: 123456" works.
 */
import { forwardRef } from 'react';
import { cn } from '@/components/ui';
import { cleanCode } from '@/features/signup/fields';

export interface CodeInputProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (code: string) => void;
  /** Called once when the last digit lands. */
  readonly onComplete?: (code: string) => void;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly testId?: string;
  readonly length?: number;
}

export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
  { id, value, onChange, onComplete, invalid, disabled, describedBy, testId, length = 6 },
  ref,
) {
  const digits = Array.from({ length }, (_, index) => value[index] ?? '');
  const activeIndex = Math.min(value.length, length - 1);
  return (
    <div className="group relative">
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {digits.map((digit, index) => (
          <span
            key={index}
            className={cn(
              'flex h-14 items-center justify-center rounded-lg border bg-panel text-xl font-semibold text-fg tabular-nums',
              'transition-[border-color,box-shadow] duration-[var(--duration-fast)] motion-reduce:transition-none',
              invalid ? 'border-danger' : 'border-border-input',
              !disabled &&
                index === activeIndex &&
                'group-focus-within:border-border-strong group-focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--border-strong)_28%,transparent)]',
              disabled && 'opacity-60',
            )}
          >
            {digit}
          </span>
        ))}
      </div>
      <input
        ref={ref}
        id={id}
        data-testid={testId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="done"
        // Roomy on purpose: a pasted "123 456" must fit before it is cleaned.
        maxLength={32}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(event) => {
          const next = cleanCode(event.target.value, length);
          onChange(next);
          if (next.length === length && next !== value) onComplete?.(next);
        }}
        className={cn(
          'absolute inset-0 size-full cursor-text rounded-lg bg-transparent text-center text-transparent caret-transparent outline-none',
          // 16 px so iOS does not zoom. The digits themselves are drawn by the boxes behind, so the
          // input's own text stays invisible, also when it is selected or filled in by the browser.
          'text-md selection:bg-transparent selection:text-transparent [-webkit-text-fill-color:transparent]',
        )}
      />
    </div>
  );
});
