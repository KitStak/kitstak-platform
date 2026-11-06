'use client';
import { forwardRef, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from './cn';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly description?: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  readonly value: string | undefined;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-describedby'?: string;
  readonly className?: string;
}

const SIZE: Readonly<Record<NonNullable<SelectProps['size']>, string>> = {
  sm: 'h-7 px-2 text-sm',
  md: 'h-8 px-2.5 text-base',
  lg: 'h-10 px-3 text-base',
};

/** Single-select dropdown with typeahead, built on Radix Select. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, onValueChange, options, placeholder = 'Select…', size = 'md', disabled, invalid, className, ...aria },
  ref,
) {
  const selected = options.find((option) => option.value === value);
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled} name={aria.name}>
      <SelectPrimitive.Trigger
        ref={ref}
        id={aria.id}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={invalid || undefined}
        className={cn(
          'group inline-flex w-full items-center justify-between gap-2 rounded-sm border border-border-input bg-panel text-left text-fg',
          'transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-out outline-none',
          'hover:border-border-input-hover focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
          'data-[state=open]:border-primary disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
          'aria-invalid:border-danger data-[placeholder]:text-fg-placeholder',
          SIZE[size],
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.icon}
          <SelectPrimitive.Value placeholder={placeholder}>{selected?.label}</SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-icon transition-transform duration-[var(--duration-fast)] group-data-[state=open]:rotate-180"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            'ks-popover-surface z-[var(--z-popover)] max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden',
            'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-icon">
            <ChevronUp aria-hidden className="size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1.5">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="ks-menu-item pr-8"
              >
                {option.icon}
                <span className="flex min-w-0 flex-1 flex-col">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.description ? <span className="truncate text-xs text-fg-muted">{option.description}</span> : null}
                </span>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex text-primary-text">
                  <Check aria-hidden className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-icon">
            <ChevronDown aria-hidden className="size-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});
