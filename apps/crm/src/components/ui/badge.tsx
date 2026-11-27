import type { ReactNode } from 'react';
import { Count, Pill, Tag, type PillTone } from '@kitstak/ui/dashboard';
import { X } from 'lucide-react';
import { cn } from './cn';
import { PILL_TEXT_CLASS, labelColorStyle, type LabelColor } from './label-color';

/**
 * Badge tones. `outline` is an identity (a key, a code, a type) and draws as the shared Tag; every
 * other tone is a state and draws as the shared Pill (docs/design/UI-CLEANUP.md, "Pills").
 * There is no crimson tone: crimson is for the brand and the one primary button.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const PILL_TONE: Readonly<Record<Exclude<BadgeTone, 'outline'>, PillTone>> = {
  neutral: 'neutral',
  success: 'positive',
  warning: 'caution',
  danger: 'critical',
  info: 'info',
};

export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  /** One leading marker. Ignored on `outline` (a Tag carries no marker). */
  readonly icon?: ReactNode;
  /** Tooltip. */
  readonly title?: string;
  /** Layout only (margins, alignment). Never colors, borders, heights or case. */
  readonly className?: string;
}

/** Small status or meta label, e.g. "Archived", "Sample", "You". One size everywhere. */
export function Badge({ children, icon, tone = 'neutral', title, className }: BadgeProps) {
  if (tone === 'outline') {
    return (
      <Tag title={title} className={className}>
        {children}
      </Tag>
    );
  }
  return (
    <Pill tone={PILL_TONE[tone]} icon={icon ?? undefined} title={title} className={className}>
      {children}
    </Pill>
  );
}

export interface CountBadgeProps {
  readonly count: number;
  /** Neutral for unread or open counts. Critical only for things that are overdue, failed or broken. */
  readonly tone?: 'neutral' | 'critical';
  /** Ring color that "cuts" the count out of the icon behind it. Leave it out when it sits beside a word. */
  readonly ringClassName?: string;
  readonly className?: string;
  /** Accessible description, e.g. "unread notifications". */
  readonly label?: string;
}

/** A count in a tab, nav item or on an icon, drawn by the shared Count. Renders nothing for 0. */
export function CountBadge({ count, tone = 'neutral', ringClassName, className, label }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span className={cn('inline-flex rounded-full', ringClassName && cn('ring-2', ringClassName), className)}>
      <Count value={count} tone={tone} label={label} />
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
    selected && 'ring-2 ring-border-strong',
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
 * A pill in a user defined label color (board labels): the Pill recipe (20 px, flat tint, no border)
 * with one dot in the label color. App states use `Badge`, which draws the shared Pill.
 */
export function StatusPill({ label, color, className }: StatusPillProps) {
  return (
    <span
      style={labelColorStyle(color)}
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1 rounded-full bg-[var(--lc-subtle)] px-2 text-xs font-medium',
        PILL_TEXT_CLASS,
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--lc-bg)]" />
      <span className="truncate">{label || '\u00a0'}</span>
    </span>
  );
}
