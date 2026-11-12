'use client';

/** Building blocks shared by widget renderers: skeletons, empty states, legend and tooltip card. */
import type { ReactNode } from 'react';
import { AlertTriangle, Database, FilterX, SearchX, Settings2 } from 'lucide-react';
import { Button, Skeleton, cn, type LabelColor } from '@/components/ui';
import type { WidgetKind } from '@/server/services/contracts/dashboard-insights';
import { cssColor } from '../lib/colors';
import { describeFilteredEmpty, useFilterHint } from './filter-context';

export function WidgetSkeleton({ kind }: { readonly kind: WidgetKind }) {
  const bars = [62, 88, 45, 72, 54, 80];
  return (
    <div className="flex h-full flex-col gap-3" data-skeleton aria-busy="true" aria-label="Loading widget">
      {kind === 'numbers' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Skeleton width="55%" height={44} rounded="md" />
          <Skeleton width={96} height={20} rounded="full" />
        </div>
      ) : kind === 'battery' ? (
        <div className="flex flex-1 flex-col justify-center gap-3">
          <Skeleton width={120} height={24} />
          <Skeleton width="100%" height={28} rounded="sm" />
          <div className="flex gap-3">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} width={64} height={12} />
            ))}
          </div>
        </div>
      ) : kind === 'table' || kind === 'leaderboard' || kind === 'workload' || kind === 'funnel' ? (
        <div className="flex flex-1 flex-col gap-2.5">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} width={kind === 'funnel' ? `${92 - index * 12}%` : '100%'} height={28} rounded="sm" className={kind === 'funnel' ? 'mx-auto' : undefined} />
          ))}
        </div>
      ) : kind === 'calendar' ? (
        <div className="grid flex-1 grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }, (_, index) => (
            <Skeleton key={index} height="100%" rounded="sm" className="min-h-6" />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-end gap-3 px-2 pb-1">
          {bars.map((height, index) => (
            <Skeleton key={index} height={`${height}%`} rounded="sm" className="flex-1" />
          ))}
        </div>
      )}
    </div>
  );
}

interface StateProps {
  readonly title: string;
  readonly description?: string;
  readonly icon: ReactNode;
  readonly action?: ReactNode;
  readonly tone?: 'neutral' | 'danger';
}

export function WidgetState({ title, description, icon, action, tone = 'neutral' }: StateProps) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-4 text-center" role={tone === 'danger' ? 'alert' : undefined}>
      <span
        aria-hidden
        className={cn(
          'flex size-10 items-center justify-center rounded-lg [&_svg]:size-5',
          tone === 'danger' ? 'bg-danger-subtle text-danger-text' : 'bg-muted text-fg-muted',
        )}
      >
        {icon}
      </span>
      <p className="text-base font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-[280px] text-sm text-fg-secondary">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function UnconfiguredState({ onConfigure }: { readonly onConfigure?: () => void }) {
  return (
    <WidgetState
      icon={<Database />}
      title="Connect boards to see data"
      description="Pick the boards this widget should read from."
      action={
        onConfigure ? (
          <Button size="sm" variant="secondary" leadingIcon={<Settings2 />} onClick={onConfigure}>
            Select boards
          </Button>
        ) : undefined
      }
    />
  );
}

export function NoDataState({ filtered, onConfigure }: { readonly filtered: boolean; readonly onConfigure?: () => void }) {
  const hint = useFilterHint();
  if (filtered) {
    const copy = describeFilteredEmpty(hint);
    const clear = hint?.search && !hint.hasPeople && !hint.hasRange ? hint.onClearSearch : hint?.onClearAll;
    return (
      <WidgetState
        icon={<SearchX />}
        title={copy.title}
        description={copy.description}
        action={
          clear ? (
            <Button size="sm" variant="secondary" leadingIcon={<FilterX />} onClick={clear}>
              {hint?.search && !hint.hasPeople && !hint.hasRange ? 'Clear search' : 'Clear filters'}
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <WidgetState
      icon={<SearchX />}
      title="No data to display yet"
      description="Items will appear here as soon as the board has some."
      action={
        onConfigure ? (
          <Button size="sm" variant="ghost" leadingIcon={<Settings2 />} onClick={onConfigure}>
            Check settings
          </Button>
        ) : undefined
      }
    />
  );
}

export function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <WidgetState
      tone="danger"
      icon={<AlertTriangle />}
      title="Couldn't load this widget"
      description="Something went wrong while crunching the numbers."
      action={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  );
}

export interface LegendEntry {
  readonly key: string;
  readonly label: string;
  readonly color: LabelColor;
  readonly detail?: string;
}

export function Legend({ entries, className }: { readonly entries: readonly LegendEntry[]; readonly className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-secondary', className)} aria-label="Legend">
      {entries.map((entry) => (
        <li key={entry.key} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: cssColor(entry.color) }} />
          <span className="truncate">{entry.label}</span>
          {entry.detail ? <span className="font-medium tabular-nums text-fg">{entry.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Floating card used by chart tooltips. */
export interface TooltipRow {
  readonly label: string;
  readonly value: string;
  readonly color?: LabelColor;
  /** The hovered segment: highlighted. */
  readonly active?: boolean;
  /** Total row: bold, neutral marker, divider above. */
  readonly total?: boolean;
}

export function TooltipCard({ title, rows }: { readonly title: string; readonly rows: readonly TooltipRow[] }) {
  return (
    <div className="min-w-[160px] rounded-lg border border-border-subtle bg-raised px-3 py-2 text-sm text-fg shadow-popover">
      <p className="mb-1 font-semibold">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.label}
            className={cn(
              'flex items-center justify-between gap-4 rounded-xs',
              row.active && '-mx-1.5 bg-hover px-1.5',
              row.total && 'mt-0.5 border-t border-border-subtle pt-1.5 font-semibold',
            )}
          >
            <span className={cn('flex items-center gap-1.5', row.active || row.total ? 'text-fg' : 'text-fg-secondary')}>
              {row.color ? <span aria-hidden className="size-2 rounded-full" style={{ background: cssColor(row.color) }} /> : null}
              {row.total ? <span aria-hidden className="size-2 rounded-xs border border-border-strong" /> : null}
              {row.label}
            </span>
            <span className={cn('tabular-nums', row.total ? 'font-semibold' : 'font-medium')}>{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
