'use client';
import { forwardRef, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  readonly invalid?: boolean;
  readonly size?: 'md' | 'lg';
}

/** A native select (best on phones and with screen readers) styled like `Input`. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, size = 'md', children, ...props },
  ref,
) {
  return (
    <span className="relative block">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full appearance-none rounded-md border bg-panel pr-8 pl-2.5 text-sm text-fg',
          size === 'lg' ? 'h-10' : 'h-8',
          'border-border-input hover:border-border-input-hover',
          'focus:field-focus',
          'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
          invalid && 'border-danger hover:border-danger focus:field-focus-danger',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-icon" />
    </span>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-20 w-full rounded-md border bg-panel px-2.5 py-2 text-sm text-fg',
        'border-border-input hover:border-border-input-hover',
        'focus:field-focus',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        invalid && 'border-danger hover:border-danger focus:field-focus-danger',
        className,
      )}
      {...props}
    />
  );
});
