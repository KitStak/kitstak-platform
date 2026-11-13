'use client';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { Tooltip } from './tooltip';

export interface ToggleGroupOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
  /** Render only the icon (label becomes the tooltip + accessible name). */
  readonly iconOnly?: boolean;
  readonly disabled?: boolean;
}

export interface ToggleGroupProps<T extends string> {
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  readonly options: readonly ToggleGroupOption<T>[];
  readonly label: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/**
 * Segmented single-choice control (radiogroup with roving tabindex). Used for density, theme,
 * chart type and similar exclusive options.
 */
export function ToggleGroup<T extends string>({
  value,
  onValueChange,
  options,
  label,
  size = 'md',
  className,
}: ToggleGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const position = enabled.indexOf(index);
    let target: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = enabled[(position + 1) % enabled.length];
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = enabled[(position - 1 + enabled.length) % enabled.length];
    if (event.key === 'Home') target = enabled[0];
    if (event.key === 'End') target = enabled[enabled.length - 1];
    if (target === undefined) return;
    event.preventDefault();
    const option = options[target];
    if (!option) return;
    refs.current[target]?.focus();
    onValueChange(option.value);
  };

  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex items-center gap-0.5 rounded-md bg-sunken p-0.5', className)}>
      {options.map((option, index) => {
        const checked = option.value === value;
        const button = (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.iconOnly ? option.label : undefined}
            disabled={option.disabled}
            tabIndex={checked ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium text-fg-secondary',
              'transition-[background-color,color,box-shadow] duration-[var(--duration-fast)] ease-out',
              'hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
              'disabled:pointer-events-none disabled:opacity-[0.38] [&_svg]:size-4 [&_svg]:shrink-0',
              checked && 'bg-raised text-fg shadow-xs ring-1 ring-[color:var(--segment-ring)]',
              size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm',
              option.iconOnly && (size === 'sm' ? 'w-6 px-0' : 'w-7 px-0'),
            )}
          >
            {option.icon}
            {option.iconOnly ? null : option.label}
          </button>
        );
        return option.iconOnly ? (
          <Tooltip key={option.value} content={option.label}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
