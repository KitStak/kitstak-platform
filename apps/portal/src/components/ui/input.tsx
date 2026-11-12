'use client';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert } from 'lucide-react';
import { cn } from './cn';

export const inputSurface = cva(
  [
    'flex w-full items-center gap-2 rounded-md border bg-panel text-fg',
    'transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-out',
    'border-border-input hover:border-border-input-hover',
    'focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)] focus-within:hover:border-primary',
    'has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-muted has-[:disabled]:opacity-60 has-[:disabled]:hover:border-border-input',
    'data-[invalid=true]:border-danger data-[invalid=true]:hover:border-danger data-[invalid=true]:focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_22%,transparent)]',
  ],
  {
    variants: {
      size: {
        md: 'h-8 px-2.5 text-sm [&_svg]:size-4',
        lg: 'h-10 px-3 text-sm [&_svg]:size-4',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'>, VariantProps<typeof inputSurface> {
  readonly leadingIcon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly invalid?: boolean;
  readonly containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, containerClassName, size, leadingIcon, trailing, invalid, ...props },
  ref,
) {
  return (
    <div
      data-invalid={invalid ? 'true' : undefined}
      className={cn(inputSurface({ size }), containerClassName)}
    >
      {leadingIcon ? <span className="flex shrink-0 text-icon">{leadingIcon}</span> : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent outline-none disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
      {trailing ? <span className="flex shrink-0 items-center text-icon">{trailing}</span> : null}
    </div>
  );
});

export interface FieldProps {
  readonly label: ReactNode;
  readonly children: (ids: {
    inputId: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
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
        <label htmlFor={inputId} className="text-xs font-medium text-fg-secondary">
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
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-2xs font-medium text-danger-text"
        >
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-2xs text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
