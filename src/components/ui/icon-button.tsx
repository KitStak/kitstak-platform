'use client';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';
import { Spinner } from './spinner';
import { Tooltip } from './tooltip';

const iconButtonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center rounded-md text-icon select-none',
    'transition-[background-color,color] duration-[var(--duration-instant)] ease-out',
    'hover:bg-hover hover:text-icon-strong active:bg-pressed',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
    'disabled:pointer-events-none disabled:opacity-[0.38]',
    'data-[active=true]:bg-selected data-[active=true]:text-primary-text',
    'data-[state=open]:bg-hover data-[state=open]:text-icon-strong',
  ],
  {
    variants: {
      size: {
        xs: 'size-6 [&_svg]:size-3.5',
        sm: 'size-7 [&_svg]:size-4',
        md: 'size-8 [&_svg]:size-[18px]',
        lg: 'size-10 [&_svg]:size-5',
      },
      variant: {
        ghost: '',
        outline: 'border border-border-input bg-panel hover:border-border-input-hover',
        solid:
          'bg-primary text-primary-fg hover:bg-primary-hover hover:text-primary-fg active:bg-primary-active data-[state=open]:bg-primary-active data-[state=open]:text-primary-fg',
        danger: 'text-danger-text hover:bg-danger-subtle hover:text-danger-text',
      },
      round: { true: 'rounded-full', false: '' },
    },
    defaultVariants: { size: 'md', variant: 'ghost', round: false },
  },
);

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible name, also used as the tooltip text. Required: icon-only controls need a name. */
  readonly label: string;
  readonly icon: ReactNode;
  /** Shortcut shown in the tooltip. */
  readonly shortcut?: readonly string[];
  readonly tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Hide the tooltip (the name is still announced). */
  readonly hideTooltip?: boolean;
  /** Selected/on state (e.g. its panel is open). */
  readonly active?: boolean;
  readonly loading?: boolean;
  /** Small overlay in the top-right corner, e.g. a CountBadge. */
  readonly badge?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    shortcut,
    tooltipSide = 'bottom',
    hideTooltip,
    active,
    loading,
    badge,
    size,
    variant,
    round,
    className,
    type = 'button',
    disabled,
    ...props
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      data-active={active ? 'true' : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(iconButtonVariants({ size, variant, round }), className)}
      {...props}
    >
      {loading ? <Spinner size="sm" label={null} /> : icon}
      {badge ? <span className="pointer-events-none absolute -top-1 -right-1">{badge}</span> : null}
    </button>
  );
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide} disabled={hideTooltip}>
      {button}
    </Tooltip>
  );
});
