'use client';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, Search, X } from 'lucide-react';
import { cn } from './cn';
import { Spinner } from './spinner';

export const inputSurface = cva(
  [
    'flex w-full items-center gap-2 rounded-sm border bg-panel text-fg',
    'transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-out',
    'border-border-input hover:border-border-input-hover',
    'focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)] focus-within:hover:border-primary',
    'has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-muted has-[:disabled]:opacity-60 has-[:disabled]:hover:border-border-input',
    'data-[invalid=true]:border-danger data-[invalid=true]:hover:border-danger data-[invalid=true]:focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_22%,transparent)]',
  ],
  {
    variants: {
      size: {
        sm: 'h-7 px-2 text-sm [&_svg]:size-3.5',
        md: 'h-8 px-2.5 text-base [&_svg]:size-4',
        lg: 'h-10 px-3 text-base [&_svg]:size-4',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'>,
    VariantProps<typeof inputSurface> {
  readonly leadingIcon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly invalid?: boolean;
  readonly loading?: boolean;
  readonly containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, containerClassName, size, leadingIcon, trailing, invalid, loading, ...props },
  ref,
) {
  return (
    <div data-invalid={invalid ? 'true' : undefined} className={cn(inputSurface({ size }), containerClassName)}>
      {leadingIcon ? <span className="flex shrink-0 text-icon">{leadingIcon}</span> : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent outline-none disabled:cursor-not-allowed',
          '[&::-webkit-search-cancel-button]:hidden',
          className,
        )}
        {...props}
      />
      {loading ? <Spinner size="xs" className="text-icon" label={null} /> : null}
      {trailing ? <span className="flex shrink-0 items-center text-icon">{trailing}</span> : null}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 3, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'block w-full resize-y rounded-sm border border-border-input bg-panel px-2.5 py-2 text-base text-fg',
        'transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-out outline-none',
        'hover:border-border-input-hover focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
});

export interface SearchInputProps extends Omit<InputProps, 'leadingIcon' | 'type' | 'onChange' | 'value'> {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** Called on Escape when the field is already empty (e.g. close the search). */
  readonly onEscape?: () => void;
  readonly clearLabel?: string;
}

/** Search field with leading magnifier, clear button and Escape-to-clear. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, onEscape, onKeyDown, clearLabel = 'Clear search', placeholder = 'Search', ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="search"
      role="searchbox"
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      leadingIcon={<Search aria-hidden />}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (value) {
            event.preventDefault();
            event.stopPropagation();
            onValueChange('');
          } else {
            onEscape?.();
          }
        }
        onKeyDown?.(event);
      }}
      trailing={
        value ? (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => onValueChange('')}
            className="-mr-1 inline-flex size-5 items-center justify-center rounded-xs text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : undefined
      }
      {...props}
    />
  );
});

export interface FieldProps {
  readonly label: ReactNode;
  readonly children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  readonly required?: boolean;
  /** Content aligned to the right of the label (e.g. "Forgot password?"). */
  readonly labelAside?: ReactNode;
  readonly className?: string;
}

/** Label + control + hint/error, wiring ids and aria-describedby. */
export function Field({ label, children, hint, error, required, labelAside, className }: FieldProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-semibold text-fg-secondary">
          {label}
          {required ? (
            <span aria-hidden className="ml-0.5 text-danger-text">
              *
            </span>
          ) : null}
        </label>
        {labelAside}
      </div>
      {children({ inputId, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-sm text-danger-text">
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
