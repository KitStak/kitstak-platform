'use client';

import * as React from 'react';
import { RadioGroup } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RadioCardOption<V extends string> {
  readonly value: V;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly badge?: 'NEW' | 'BETA';
  readonly disabled?: boolean;
}

export interface RadioCardsProps<V extends string> {
  readonly options: readonly RadioCardOption<V>[];
  readonly value: V | null;
  readonly onChange: (value: V) => void;
  readonly columns?: 1 | 2 | 3;
  /** Show a trailing chevron (chooser that advances to the next step). */
  readonly chevron?: boolean;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly 'aria-invalid'?: boolean;
}

const COLUMN_CLASS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
} as const;

/** Card chooser: title, description, icon, NEW/BETA badge, chevron. Arrow keys move. */
export function RadioCards<V extends string>({
  options,
  value,
  onChange,
  columns = 1,
  chevron = false,
  ariaLabel,
  className,
  'aria-invalid': invalid,
}: RadioCardsProps<V>) {
  return (
    <RadioGroup.Root
      value={value ?? ''}
      onValueChange={(next) => onChange(next as V)}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      className={cn('grid gap-2.5', COLUMN_CLASS[columns], className)}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={cn(
              'group flex w-full items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-left outline-none transition-[border-color,box-shadow,background-color]',
              'border-border hover:border-border-strong hover:shadow-xs focus-visible:ring-2 focus-visible:ring-focus/30',
              'data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft/60 data-[state=checked]:shadow-[0_0_0_1px_var(--primary)]',
              'active:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50',
              invalid && 'border-danger',
            )}
          >
            {Icon ? (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-soft text-secondary group-data-[state=checked]:bg-primary group-data-[state=checked]:text-white">
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
            ) : (
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border-strong group-data-[state=checked]:border-primary"
                aria-hidden
              >
                <RadioGroup.Indicator className="h-2 w-2 rounded-full bg-primary" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {option.title}
                {option.badge ? (
                  <span
                    className={cn(
                      'rounded px-1.5 py-px text-2xs font-bold tracking-wide',
                      option.badge === 'NEW'
                        ? 'bg-success-soft text-success'
                        : 'bg-warning-soft text-warning',
                    )}
                  >
                    {option.badge}
                  </span>
                ) : null}
              </span>
              {option.description ? (
                <span className="mt-0.5 block text-xs leading-4 text-secondary">{option.description}</span>
              ) : null}
            </span>
            {chevron ? (
              <ChevronRight
                className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-secondary"
                aria-hidden
              />
            ) : null}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
