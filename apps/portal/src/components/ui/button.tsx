'use client';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';
import { Spinner } from './spinner';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none',
    'font-medium rounded-md border border-transparent',
    'transition-[background-color,border-color,color,box-shadow,opacity] duration-[var(--duration-instant)] ease-out',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    'disabled:pointer-events-none disabled:opacity-[0.38] aria-disabled:pointer-events-none aria-disabled:opacity-[0.38]',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active',
        secondary:
          'bg-panel text-fg border-border-input hover:bg-muted hover:border-border-input-hover active:bg-pressed',
        tertiary: 'bg-transparent text-fg hover:bg-hover active:bg-pressed',
        ghost: 'bg-transparent text-fg-secondary hover:bg-hover hover:text-fg active:bg-pressed',
        danger:
          'bg-panel text-danger-text border-danger/45 hover:bg-danger-subtle hover:border-danger active:bg-danger-subtle',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-4',
        md: 'h-8 px-3 text-sm [&_svg]:size-4',
        lg: 'h-10 px-4 text-base [&_svg]:size-5',
      },
      fullWidth: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', fullWidth: false },
  },
);

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
