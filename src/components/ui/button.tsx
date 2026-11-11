'use client';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
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
        primary:
          'bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active data-[pressed=true]:bg-primary-active',
        secondary:
          'bg-panel text-fg border-border-input hover:bg-muted hover:border-border-input-hover active:bg-pressed data-[pressed=true]:bg-selected data-[pressed=true]:border-border-strong',
        tertiary:
          'bg-transparent text-fg hover:bg-hover active:bg-pressed data-[pressed=true]:bg-selected',
        ghost:
          'bg-transparent text-fg-secondary hover:bg-hover hover:text-fg active:bg-pressed data-[pressed=true]:bg-selected data-[pressed=true]:text-fg',
        danger:
          // Destructive actions are outlined, not filled, so they never read as the crimson primary.
          'bg-panel text-danger-text border-danger/45 hover:bg-danger-subtle hover:border-danger active:bg-danger-subtle data-[pressed=true]:bg-danger-subtle',
        'danger-ghost': 'bg-transparent text-danger-text hover:bg-danger-subtle active:bg-danger-subtle',
      },
      size: {
        xs: 'h-6 px-2 text-xs [&_svg]:size-3.5',
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-4',
        md: 'h-8 px-3 text-sm [&_svg]:size-4',
        lg: 'h-10 px-4 text-base [&_svg]:size-5',
      },
      iconOnly: { true: 'px-0', false: '' },
      fullWidth: { true: 'w-full', false: '' },
    },
    compoundVariants: [
      { iconOnly: true, size: 'xs', class: 'w-6' },
      { iconOnly: true, size: 'sm', class: 'w-7' },
      { iconOnly: true, size: 'md', class: 'w-8' },
      { iconOnly: true, size: 'lg', class: 'w-10' },
    ],
    defaultVariants: { variant: 'primary', size: 'md', iconOnly: false, fullWidth: false },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    Omit<VariantProps<typeof buttonVariants>, 'iconOnly'> {
  readonly children?: ReactNode;
  /** Icon rendered before the label. */
  readonly leadingIcon?: ReactNode;
  /** Icon rendered after the label. */
  readonly trailingIcon?: ReactNode;
  /** Shows a spinner, keeps the button width stable and blocks interaction. */
  readonly loading?: boolean;
  /** Persistent "on" state for toggle-like buttons (sets aria-pressed). */
  readonly pressed?: boolean;
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
    pressed,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      data-pressed={pressed ? 'true' : undefined}
      {...props}
    >
      <span className={cn('inline-flex items-center gap-1.5', loading && 'invisible')}>
        {leadingIcon}
        {children}
        {trailingIcon}
      </span>
      {loading ? (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner size={size === 'lg' ? 'md' : 'sm'} label={null} />
        </span>
      ) : null}
    </button>
  );
});

export interface SplitButtonProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly variant?: Extract<ButtonVariant, 'primary' | 'secondary'>;
  readonly size?: ButtonSize;
  readonly leadingIcon?: ReactNode;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  /** Accessible name of the menu trigger, e.g. "More ways to add". */
  readonly menuLabel: string;
  /**
   * Render prop receiving the chevron trigger. Wrap it in `<DropdownMenu><DropdownMenuTrigger asChild>`
   * so the menu content stays fully owned by the caller.
   */
  readonly renderMenu: (trigger: ReactNode) => ReactNode;
  readonly className?: string;
}

/** Primary action plus an attached chevron that opens a menu of related actions. */
export function SplitButton({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  leadingIcon,
  disabled,
  loading,
  menuLabel,
  renderMenu,
  className,
}: SplitButtonProps) {
  const divider = variant === 'primary' ? 'border-l-white/30' : 'border-l-border-input';
  const trigger = (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      aria-label={menuLabel}
      className={cn('rounded-l-none border-l px-1.5', divider, variant === 'secondary' && '-ml-px')}
    >
      <ChevronDown aria-hidden />
    </Button>
  );
  return (
    <div role="group" className={cn('inline-flex items-stretch', className)}>
      <Button
        variant={variant}
        size={size}
        onClick={onClick}
        disabled={disabled}
        loading={loading}
        leadingIcon={leadingIcon}
        className="rounded-r-none"
      >
        {children}
      </Button>
      {renderMenu(trigger)}
    </div>
  );
}
