'use client';
import type { ReactNode } from 'react';
import { Avatar, cn, type AvatarSize } from '@/components/ui';

/** Pixel size of each Avatar size (keep in sync with components/ui/avatar.tsx). */
const PX: Readonly<Record<AvatarSize, number>> = { xs: 20, sm: 24, md: 32, lg: 40, xl: 64 };

export interface StackEntry {
  readonly key: string;
  readonly node: ReactNode;
  readonly square?: boolean;
}

/**
 * Overlapping avatar stack. Each tile sits in its own positioned layer with a 2px ring in the
 * cell surface color; later tiles stack ABOVE earlier ones so the ring cuts a clean gap.
 * Overlap is ~10% of the tile so two-letter initials stay readable.
 */
export function AvatarStack({
  entries,
  overflow,
  size,
  className,
}: {
  readonly entries: readonly StackEntry[];
  readonly overflow?: number;
  readonly size: AvatarSize;
  readonly className?: string;
}) {
  const px = PX[size];
  // Small overlap (the 2px ring adds visual separation) so two-letter initials stay whole.
  const overlap = Math.max(2, Math.round(px * 0.1));
  return (
    <span className={cn('isolate flex items-center', className)}>
      {entries.map((entry, index) => (
        <span
          key={entry.key}
          className={cn(
            'relative inline-flex ring-2 ring-[var(--ks-cell-surface,var(--surface-panel))]',
            entry.square ? 'rounded-md' : 'rounded-full',
          )}
          style={{ zIndex: index + 1, marginLeft: index === 0 ? 0 : -overlap }}
        >
          {entry.node}
        </span>
      ))}
      {overflow ? (
        <span
          className={cn(
            'relative inline-flex items-center justify-center rounded-full bg-muted px-1 font-semibold text-fg-secondary tabular-nums ring-2 ring-[var(--ks-cell-surface,var(--surface-panel))]',
            px <= 20 ? 'h-5 min-w-6 px-1.5 text-[10px]' : px >= 32 ? 'h-8 min-w-8 text-xs' : 'h-6 min-w-7 px-1.5 text-[11px]',
          )}
          style={{ zIndex: entries.length + 1, marginLeft: entries.length ? 2 : 0 }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

export function StackAvatar({
  name,
  src,
  colorKey,
  size,
}: {
  readonly name: string;
  readonly src?: string | null;
  readonly colorKey: string;
  readonly size: AvatarSize;
}) {
  const px = PX[size];
  // Initials sized for the tile: one letter on 20px tiles, a 10px pair on 24px tiles so the
  // glyphs never touch the circle edge.
  return (
    <Avatar
      name={name}
      src={src}
      colorKey={colorKey}
      size={size}
      maxInitials={px < 22 ? 1 : 2}
      className={px <= 24 ? '[&>span:first-child]:text-[10px] [&>span:first-child]:tracking-[-0.01em]' : undefined}
    />
  );
}
