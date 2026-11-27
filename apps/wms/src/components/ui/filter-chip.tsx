import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FilterChipProps {
  readonly label: React.ReactNode;
  /** The live total shown after the label (already formatted), or a loading node. */
  readonly count?: React.ReactNode;
  /** Status dot colour (a tone's `dot`); leave out for "All". */
  readonly dot?: string;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly title?: string;
  readonly countTitle?: string;
  readonly className?: string;
}

/**
 * A status filter chip above a list ("Open 12"). Clicking it filters the list. The selected chip
 * gets the neutral selected surface and a strong border, never crimson and never the status tint
 * (docs/design/UI-CLEANUP.md: crimson is for the brand, the primary button and the active nav).
 */
export function FilterChip({
  label,
  count,
  dot,
  active,
  onClick,
  title,
  countTitle,
  className,
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30',
        active
          ? 'border-border-strong bg-selected font-medium text-fg'
          : 'border-border bg-surface text-body hover:border-border-strong hover:bg-surface-sunken',
        className,
      )}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />
      ) : null}
      <span className={active ? undefined : 'text-secondary'}>{label}</span>
      {count === undefined ? null : (
        <span className="font-semibold tabular-nums text-foreground" title={countTitle}>
          {count}
        </span>
      )}
    </button>
  );
}
