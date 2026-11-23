'use client';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { buttonVariants } from './button-variants';
import { cn } from './cn';
import { Spinner } from './spinner';

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>, VariantProps<typeof buttonVariants> {
  readonly children?: ReactNode;
  readonly leadingIcon?: ReactNode;
  readonly trailingIcon?: ReactNode;
  /** Shows a spinner, keeps the button width stable and blocks interaction. */
  readonly loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    fullWidth,
    leadingIcon,
    trailingIcon,
    loading = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    >
      {loading ? (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner size="xs" label={null} />
        </span>
      ) : null}
      <span className={cn('inline-flex items-center gap-1.5', loading && 'invisible')}>
        {leadingIcon}
        {children}
        {trailingIcon}
      </span>
    </button>
  );
});
