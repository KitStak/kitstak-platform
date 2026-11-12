'use client';

/**
 * Chip input (BUILD_PLAN F4.2) for barcodes, tracking numbers and tags. Enter, comma,
 * Tab or paste (newline/comma separated) commits; Backspace on empty removes the last
 * chip. Works with keyboard-wedge scanners because they terminate with Enter.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { controlVariants, errorTextClass } from './control-styles';

export interface ChipInputProps {
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly placeholder?: string;
  /** Return an error message to reject a token. */
  readonly validate?: (token: string) => string | null;
  readonly maxItems?: number;
  readonly maxLength?: number;
  /** Case-insensitive duplicate check. Default true. */
  readonly caseInsensitive?: boolean;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly id?: string;
  readonly className?: string;
  readonly onBlur?: () => void;
  readonly 'aria-label'?: string;
  readonly 'aria-describedby'?: string;
}

export function splitTokens(text: string): readonly string[] {
  return text
    .split(/[\n\r,;\t]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Pure merge: returns the new list and the first rejection message (if any). */
export function addTokens(
  current: readonly string[],
  tokens: readonly string[],
  {
    validate,
    maxItems,
    maxLength,
    caseInsensitive = true,
  }: Pick<ChipInputProps, 'validate' | 'maxItems' | 'maxLength' | 'caseInsensitive'>,
): { readonly value: readonly string[]; readonly error: string | null } {
  const key = (t: string) => (caseInsensitive ? t.toLowerCase() : t);
  const seen = new Set(current.map(key));
  const next = [...current];
  let error: string | null = null;
  for (const token of tokens) {
    if (maxItems !== undefined && next.length >= maxItems) {
      error = `You can add at most ${maxItems} items.`;
      break;
    }
    if (maxLength !== undefined && token.length > maxLength) {
      error = `"${token.slice(0, 24)}…" is longer than ${maxLength} characters.`;
      continue;
    }
    const message = validate?.(token) ?? null;
    if (message) {
      error = message;
      continue;
    }
    if (seen.has(key(token))) {
      error = `"${token}" is already added.`;
      continue;
    }
    seen.add(key(token));
    next.push(token);
  }
  return { value: next, error };
}

export const ChipInput = React.forwardRef<HTMLInputElement, ChipInputProps>(
  (
    {
      value,
      onChange,
      placeholder = 'Type and press Enter',
      validate,
      maxItems,
      maxLength,
      caseInsensitive,
      disabled,
      invalid,
      id,
      className,
      onBlur,
      ...aria
    },
    ref,
  ) => {
    const [text, setText] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const errorId = React.useId();

    const commit = (raw: string) => {
      const tokens = splitTokens(raw);
      if (!tokens.length) return;
      const result = addTokens(value, tokens, { validate, maxItems, maxLength, caseInsensitive });
      setError(result.error);
      if (result.value.length !== value.length) onChange(result.value);
      setText('');
    };

    return (
      <div className="flex w-full flex-col gap-1">
        <div
          data-invalid={invalid || Boolean(error) || undefined}
          data-disabled={disabled || undefined}
          className={cn(
            controlVariants({ size: 'md' }),
            'flex h-auto min-h-8 flex-wrap items-center gap-1 py-1',
            className,
          )}
        >
          {value.map((chip) => (
            <span
              key={chip}
              className="inline-flex max-w-full items-center gap-1 rounded bg-neutral-soft py-0.5 pl-1.5 pr-0.5 font-mono text-xs text-body"
            >
              <span className="truncate">{chip}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${chip}`}
                onClick={() => onChange(value.filter((v) => v !== chip))}
                className="rounded p-px text-faint hover:bg-border hover:text-body"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          <input
            ref={ref}
            id={id}
            value={text}
            disabled={disabled}
            placeholder={value.length ? '' : placeholder}
            aria-invalid={invalid || Boolean(error) || undefined}
            aria-label={aria['aria-label']}
            aria-describedby={
              [aria['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined
            }
            onChange={(e) => {
              setError(null);
              setText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (
                (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && text.trim())) &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                commit(text);
              } else if (e.key === 'Backspace' && !text && value.length) {
                onChange(value.slice(0, -1));
              }
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (/[\n\r,;\t]/.test(pasted)) {
                e.preventDefault();
                commit(`${text}${pasted}`);
              }
            }}
            onBlur={() => {
              commit(text);
              onBlur?.();
            }}
            className="h-6 min-w-[100px] flex-1 bg-transparent outline-none placeholder:text-faint disabled:cursor-not-allowed"
            autoComplete="off"
          />
        </div>
        {error ? (
          <span id={errorId} role="alert" className={errorTextClass}>
            {error}
          </span>
        ) : null}
      </div>
    );
  },
);
ChipInput.displayName = 'ChipInput';
