'use client';
import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
  readonly autoFocus?: boolean;
  /** Start with the list open (used by `GridSelect` when it swaps in on a click). */
  readonly defaultOpen?: boolean;
  /** Told each time the list opens or closes. */
  readonly onOpenChange?: (open: boolean) => void;
  readonly 'data-testid'?: string;
}

const SIZE: Readonly<Record<NonNullable<SelectProps['size']>, string>> = {
  sm: 'h-7 px-2 text-sm',
  md: 'h-8 px-2.5 text-sm',
  lg: 'h-10 px-3 text-sm',
};

const triggerClass = (size: NonNullable<SelectProps['size']>, className?: string): string =>
  cn(
    'group inline-flex w-full items-center justify-between gap-2 rounded-md border border-border-input bg-panel text-left text-fg',
    'transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-out outline-none',
    'hover:border-border-input-hover focus-visible:border-focus focus-visible:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
    'data-[state=open]:border-focus disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
    'aria-invalid:border-danger aria-invalid:shadow-[inset_0_0_0_1px_var(--danger)] aria-invalid:focus-visible:border-danger aria-invalid:focus-visible:shadow-[inset_0_0_0_1px_var(--danger),0_0_0_3px_var(--focus-ring-soft)] data-[placeholder]:text-fg-placeholder',
    SIZE[size],
    className,
  );

/** Single-select dropdown with typeahead, built on Radix Select. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, onValueChange, options, placeholder = 'Select…', size = 'md', disabled, invalid, className, autoFocus, defaultOpen, onOpenChange, 'data-testid': testId, ...aria },
  ref,
) {
  const selected = options.find((option) => option.value === value);
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled} name={aria.name} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <SelectPrimitive.Trigger
        ref={ref}
        id={aria.id}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        data-testid={testId}
        className={triggerClass(size, className)}
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

/**
 * The same Select for a dense grid with one picker on every row. It draws a plain trigger that
 * looks and reads like the real one, and swaps the real Select in the moment a person reaches it
 * (Tab, a click or a tap). So a grid of 30 pickers draws as fast as plain boxes, and the keyboard
 * works the same: type a letter to jump, Enter or Space opens the list, Tab moves on.
 */
export function GridSelect(props: SelectProps) {
  const { value, options, placeholder = 'Select…', size = 'md', disabled, invalid, className } = props;
  const [live, setLive] = useState<'no' | 'closed' | 'open'>('no');
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  useEffect(() => {
    if (live !== 'no') trigger.current?.focus({ preventScroll: true });
  }, [live]);
  if (live !== 'no') return <Select {...props} ref={trigger} defaultOpen={live === 'open'} />;
  const selected = options.find((option) => option.value === value);
  return (
    <button
      type="button"
      role="combobox"
      id={props.id}
      aria-label={props['aria-label']}
      aria-describedby={props['aria-describedby']}
      aria-expanded={false}
      aria-controls={listId}
      aria-haspopup="listbox"
      aria-invalid={invalid || undefined}
      data-testid={props['data-testid']}
      data-placeholder={selected ? undefined : ''}
      disabled={disabled}
      className={triggerClass(size, className)}
      onFocus={() => setLive('closed')}
      onPointerDown={(event) => {
        if (event.button !== 0 || disabled) return;
        event.preventDefault();
        setLive('open');
      }}
    >
      <span className="flex min-w-0 items-center gap-2 truncate">
        {selected?.icon}
        <span>{selected?.label ?? placeholder}</span>
      </span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-icon" />
    </button>
  );
}
