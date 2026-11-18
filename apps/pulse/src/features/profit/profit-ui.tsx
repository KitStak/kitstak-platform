'use client';
/** Small pieces the profit screens share: the retry panel, sortable headers, delta badges for tiles and section cards. */
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CircleAlert, RotateCw } from 'lucide-react';
import type { DeltaBadgeProps } from '@/components/charts/stats';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { cn } from '@/components/ui/cn';
import { formatMoneyDelta, formatNumberDelta, formatPercentDelta, formatPointsDelta } from '@/lib/format';
import { compareMoney, compareNumber } from '@/lib/profit/trends';
import type { SortState } from './profit-model';

/** A read failed: say so in plain words and offer the retry. */
export function LoadError({ what, message, onRetry, compact = false }: { readonly what: string; readonly message?: string; readonly onRetry?: () => void; readonly compact?: boolean }) {
  return (
    <div role="alert" data-testid="load-error" className={cn('flex flex-col items-center gap-3 rounded-xl border border-border-subtle bg-panel text-center', compact ? 'px-4 py-6' : 'px-6 py-10')}>
      <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl bg-danger-subtle text-danger-text">
        <CircleAlert className="size-6" />
      </span>
      <div>
        <p className="text-md font-semibold text-fg">We could not load {what}</p>
        <p className="mt-1 text-sm text-fg-secondary">{message ?? 'Check your connection and try again.'}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" leadingIcon={<RotateCw aria-hidden />} onClick={onRetry} data-testid="load-retry">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** A column header that sorts. Numbers start biggest first, names start A to Z. */
export function SortHeader({ id, label, sort, onSort, numeric, title }: { readonly id: string; readonly label: string; readonly sort: SortState; readonly onSort: (next: SortState) => void; readonly numeric?: boolean; readonly title?: string }) {
  const active = sort.column === id;
  const first = numeric ? 'desc' : 'asc';
  return (
    <button
      type="button"
      title={title}
      aria-label={`Sort by ${label}${active ? (sort.direction === 'asc' ? ', smallest first now' : ', biggest first now') : ''}`}
      onClick={() => onSort(active ? { column: id, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : { column: id, direction: first })}
      className={cn('inline-flex items-center gap-1 rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', numeric && 'flex-row-reverse', active && 'text-fg')}
      data-testid={`sort-${id}`}
    >
      <span>{label}</span>
      {active ? sort.direction === 'asc' ? <ArrowUp aria-hidden className="size-3 shrink-0" /> : <ArrowDown aria-hidden className="size-3 shrink-0" /> : <ArrowUpDown aria-hidden className="size-3 shrink-0 opacity-40" />}
    </button>
  );
}

/** A money change for a KPI tile, or nothing when there is no earlier number. */
export function moneyDelta(current: number | null, previous: number | null | undefined, goodWhen: 'up' | 'down', label: string): DeltaBadgeProps | undefined {
  if (current === null || previous === null || previous === undefined) return undefined;
  const change = compareMoney(BigInt(current), BigInt(previous), goodWhen);
  if (change.deltaCents === null) return undefined;
  // Past five times the earlier number a percent stops meaning anything: the money says it all.
  const percent = change.changeBp === null || Math.abs(change.changeBp) > 50000 ? '' : ` (${formatPercentDelta(change.changeBp)})`;
  return { delta: change.deltaCents, text: `${formatMoneyDelta(change.deltaCents, { cents: false })}${percent}`, goodWhen, label };
}

/** A change in a percent, in points. */
export function pointsDelta(current: number | null, previous: number | null | undefined, goodWhen: 'up' | 'down', label: string): DeltaBadgeProps | undefined {
  const change = compareNumber(current, previous ?? null, goodWhen);
  if (change.delta === null) return undefined;
  return { delta: change.delta, text: formatPointsDelta(change.delta), goodWhen, label };
}

/** A change in a plain number (units, hours, pace). */
export function numberDelta(current: number | null, previous: number | null | undefined, goodWhen: 'up' | 'down', label: string, digits = 0): DeltaBadgeProps | undefined {
  const change = compareNumber(current, previous ?? null, goodWhen);
  if (change.delta === null) return undefined;
  const percent = change.changeBp === null ? '' : ` (${formatPercentDelta(change.changeBp)})`;
  return { delta: change.delta, text: `${formatNumberDelta(change.delta, { maxDigits: digits })}${percent}`, goodWhen, label };
}

/** A titled card with an optional action on the right and no padding rules of its own. */
export function Section({ title, hint, action, children, className, bodyClassName, testId }: { readonly title: string; readonly hint?: ReactNode; readonly action?: ReactNode; readonly children: ReactNode; readonly className?: string; readonly bodyClassName?: string; readonly testId?: string }) {
  return (
    <section data-testid={testId} className={cn('flex min-w-0 flex-col rounded-xl border border-border-subtle bg-panel shadow-xs', className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-fg-muted">{hint}</p> : null}
        </div>
        {action ? <div className="flex max-w-full min-w-0 items-center gap-2">{action}</div> : null}
      </header>
      <div className={cn('min-w-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Skeleton rows for a table that is loading. */
export function TableSkeleton({ rows = 8, label }: { readonly rows?: number; readonly label: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2 p-4" data-testid="table-skeleton">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} aria-hidden className="ks-skeleton block h-7 w-full rounded-md" style={{ opacity: 1 - index * 0.08 }} />
      ))}
    </div>
  );
}

/**
 * The total of the period to compare with, or null when that period had no activity at all. A
 * change against nothing is not a change worth showing: "+$69,702" would only repeat the number.
 */
export function comparable<T extends { readonly rows: readonly unknown[]; readonly total: unknown }>(response: T | undefined): T['total'] | null {
  return response && response.rows.length > 0 ? response.total : null;
}

/**
 * Runs a server action that returns nothing (a delete) and says whether it worked. On a failure
 * it shows the server's plain message. `useServerAction` cannot tell "deleted" from "failed"
 * for these, because both come back with no data.
 */
export async function runDelete<I>(action: (input: I) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: { readonly message: string } }>, input: I, errorTitle: string): Promise<boolean> {
  try {
    const result = await action(input);
    if (result.ok) return true;
    toast.error(errorTitle, result.error.message);
    return false;
  } catch {
    toast.error(errorTitle, 'Check your connection and try again.');
    return false;
  }
}
