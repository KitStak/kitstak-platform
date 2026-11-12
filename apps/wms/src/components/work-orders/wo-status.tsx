'use client';

/**
 * Work order status colours (Logiwa parity): Open is teal (rgb 208,243,238 / 22,194,170), so it
 * reads differently from Completed (green). Other statuses use the shared work-order map.
 * `WoStatusPill` is the grid / header pill; `WoStatusFilter` is the list's status pill row with
 * a clearly filled active state.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { pillClass, statusLabel, statusTone, TONES, type StatusTone } from '@/lib/status-colors';

export function woStatusTone(status: string): StatusTone {
  return status.toLowerCase() === 'open' ? TONES.teal : statusTone(status, 'workOrder');
}

/** Saturated accent of a status (dot, active border). */
export function woStatusAccent(status: string): string {
  return woStatusTone(status).dot;
}

/**
 * Light: the pastel fill. Dark (`data-theme=dark`): a low-alpha tint of the accent with a lighter
 * foreground and a hairline ring, so pills don't glow on near-black surfaces.
 */
export const WO_PILL_TONE = 'bg-[var(--wo-bg)] text-[var(--wo-fg)]';

export function WoStatusPill({
  status,
  size = 'md',
  className,
}: {
  readonly status: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}) {
  const tone = woStatusTone(status);
  const vars = {
    '--wo-bg': tone.bg,
    '--wo-fg': tone.fg,
    '--wo-acc': woStatusAccent(status),
  } as React.CSSProperties;
  return (
    <span data-status={status} style={vars} className={cn(WO_PILL_TONE, pillClass(size), className)}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--wo-acc)]" />
      <span className="truncate">{statusLabel(status)}</span>
    </span>
  );
}

export interface WoStatusFilterItem {
  readonly key: string;
  readonly label: string;
  /** Formatted count; null while counts load (renders a count skeleton, not "…"). */
  readonly count: string | null;
  /** Tooltip for the count (e.g. why it shows "—"). */
  readonly countTitle?: string;
  /** null = the "All" pill. */
  readonly status: string | null;
  readonly active: boolean;
  readonly onClick: () => void;
}

/** One status filter pill: dot + label + count; the active one is filled in its status colour. */
export function WoStatusFilterPill({ item }: { readonly item: WoStatusFilterItem }) {
  const tone = item.status ? woStatusTone(item.status) : null;
  const accent = item.status ? woStatusAccent(item.status) : 'var(--color-primary)';
  return (
    <button
      type="button"
      onClick={item.onClick}
      aria-pressed={item.active}
      style={
        item.active
          ? ({
              '--wo-bg': tone?.bg ?? 'var(--color-primary-soft)',
              '--wo-fg': tone?.fg ?? 'var(--color-primary)',
              '--wo-acc': accent,
              borderColor: accent,
              boxShadow: `inset 0 0 0 1px ${accent}`,
            } as React.CSSProperties)
          : undefined
      }
      className={cn(
        item.active && WO_PILL_TONE,
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        item.active
          ? 'font-semibold'
          : 'border-border bg-surface text-body hover:border-border-strong hover:bg-surface-sunken',
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
      <span className={item.active ? undefined : 'text-secondary'}>{item.label}</span>
      {item.count === null ? (
        <span
          className="inline-block h-2.5 w-5 animate-pulse rounded-full bg-surface-sunken motion-reduce:animate-none"
          aria-label="Loading count"
          role="status"
        />
      ) : (
        <span
          className={cn('font-semibold tabular-nums', item.active ? undefined : 'text-foreground')}
          title={item.countTitle}
        >
          {item.count}
        </span>
      )}
    </button>
  );
}
