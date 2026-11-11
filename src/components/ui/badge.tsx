import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from './cn';
import { PILL_TEXT_CLASS, labelColorStyle, type LabelColor } from './label-color';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-sm font-medium [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-fg-secondary',
        primary: 'bg-primary-subtle text-primary-text',
        success: 'bg-success-subtle text-success-text',
        warning: 'bg-warning-subtle text-warning-text',
        danger: 'bg-danger-subtle text-danger-text',
        info: 'bg-info-subtle text-info-text',
        solid: 'bg-primary text-primary-fg',
        outline: 'border border-border-default bg-transparent text-fg-secondary',
      },
      size: { sm: 'h-[18px] px-1.5 text-2xs', md: 'h-5 px-2 text-xs' },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  readonly className?: string;
}

/** Small status/meta label, e.g. "Beta", "Private", "Admin". */
export function Badge({ children, icon, tone, size, className }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)}>
      {icon}
      {children}
    </span>
  );
}

export interface CountBadgeProps {
  readonly count: number;
  readonly max?: number;
  readonly tone?: 'danger' | 'primary' | 'neutral';
  /** Ring color that "cuts" the badge out of the surface behind it. */
  readonly ringClassName?: string;
  readonly className?: string;
  /** Accessible description, e.g. "unread notifications". */
  readonly label?: string;
}

/** Numeric pill for unread counts. Renders nothing for 0. */
export function CountBadge({ count, max = 99, tone = 'danger', ringClassName, className, label }: CountBadgeProps) {
  if (count <= 0) return null;
  const text = count > max ? `${max}+` : String(count);
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold tabular-nums ring-2',
        tone === 'danger' && 'bg-danger text-white',
        tone === 'primary' && 'bg-primary text-primary-fg',
        tone === 'neutral' && 'bg-muted text-fg-secondary',
        ringClassName ?? 'ring-[var(--surface-app)]',
        className,
      )}
    >
      {text}
      {label ? <span className="sr-only"> {label}</span> : null}
    </span>
  );
}

export interface ChipProps {
  readonly children: ReactNode;
  readonly color?: LabelColor;
  /** `solid` = full label color with its foreground; `subtle` = tinted surface. */
  readonly appearance?: 'solid' | 'subtle' | 'outline';
  readonly icon?: ReactNode;
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
  readonly onClick?: () => void;
  readonly selected?: boolean;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/**
 * Pill / chip for tags, filters and people. Clickable chips render as buttons; removable chips
 * expose a separate remove button so both actions are keyboard reachable.
 */
export function Chip({
  children,
  color,
  appearance = 'subtle',
  icon,
  onRemove,
  removeLabel = 'Remove',
  onClick,
  selected,
  size = 'md',
  className,
}: ChipProps) {
  const colored = Boolean(color);
  const classes = cn(
    'inline-flex max-w-full items-center gap-1 rounded-full font-medium transition-[background-color,box-shadow,color] duration-[var(--duration-instant)]',
    size === 'sm' ? 'h-5 px-2 text-xs [&_svg]:size-3' : 'h-6 px-2.5 text-sm [&_svg]:size-3.5',
    colored && appearance === 'solid' && 'bg-[var(--lc-bg)] text-[var(--lc-fg)]',
    colored && appearance === 'subtle' && 'bg-[var(--lc-subtle)] text-fg',
    colored && appearance === 'outline' && 'border border-[var(--lc-bg)] text-fg',
    !colored && appearance !== 'outline' && 'bg-muted text-fg',
    !colored && appearance === 'outline' && 'border border-border-default text-fg',
    onClick && 'cursor-pointer hover:shadow-[inset_0_0_0_100px_var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
    selected && 'ring-2 ring-primary',
    onRemove && 'pr-1',
    className,
  );
  const style = color ? labelColorStyle(color) : undefined;
  const content = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  return (
    <span className={classes} style={style}>
      {onClick ? (
        <button type="button" onClick={onClick} aria-pressed={selected} className="inline-flex min-w-0 items-center gap-1 outline-none">
          {content}
        </button>
      ) : (
        content
      )}
      {onRemove ? (
        <button
          type="button"
          aria-label={typeof children === 'string' ? `${removeLabel} ${children}` : removeLabel}
          onClick={onRemove}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full opacity-70 hover:bg-black/10 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X aria-hidden className="!size-3" />
        </button>
      ) : null}
    </span>
  );
}

export interface StatusPillProps {
  readonly label: string;
  readonly color: LabelColor;
  readonly className?: string;
}

/**
 * The one status pill (shared recipe with KitStak WMS): tinted background, the label colour as
 * text and a solid dot. Use it for any status or priority outside the board grid.
 */
export function StatusPill({ label, color, className }: StatusPillProps) {
  return (
    <span
      style={labelColorStyle(color)}
      className={cn(
        'inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-full bg-[var(--lc-subtle)] px-2 text-xs font-medium',
        PILL_TEXT_CLASS,
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--lc-bg)]" />
      <span className="truncate">{label || '\u00a0'}</span>
    </span>
  );
}
