'use client';
/**
 * Small stat helpers: KpiTile (one headline number with its change, trend and a "how we got
 * this" slot), DeltaBadge (a change with an arrow and a good or bad tone) and MarginPill (margin
 * health as icon plus words, so it reads the same for color blind people).
 */
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, CircleCheck, CircleHelp, Eye, Minus, TrendingDown, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { PULSE_STATUS_LABELS, type PulseStatus } from '@/lib/constants';
import { deltaDirection, deltaTone, formatPercentBp } from '@/lib/format';
import { DEFAULT_RISK_THRESHOLDS } from '@/lib/profit/risk';
import type { ChartFormat } from './chart-format';
import { Sparkline } from './sparkline';

// --- DeltaBadge ---------------------------------------------------------------------------

export interface DeltaBadgeProps {
  /** The raw change. Only its sign is used here: it picks the arrow and the tone. */
  readonly delta: number | bigint | null | undefined;
  /** The change as text, from `formatMoneyDelta`, `formatPercentDelta` or `formatPointsDelta`. */
  readonly text: string;
  /** Which way is good: `up` for revenue, profit, margin and pace; `down` for costs and hours. */
  readonly goodWhen?: 'up' | 'down';
  /** What it is compared with: "vs last month". */
  readonly label?: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

const DELTA_WORD = { up: 'Up', down: 'Down', flat: 'No change' } as const;
const TONE_WORD = { good: 'better', bad: 'worse', neutral: '' } as const;

export function DeltaBadge({ delta, text, goodWhen = 'up', label, size = 'md', className }: DeltaBadgeProps) {
  const missing = delta === null || delta === undefined;
  // A change too small to show ("0 points", "$0") reads as no change: no arrow and no good or bad color.
  const rounded = missing || /[1-9]/.test(text) ? delta : 0;
  const direction = deltaDirection(rounded);
  const tone = deltaTone(rounded, goodWhen);
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  return (
    <span className={cn('inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5', size === 'sm' ? 'text-2xs' : 'text-xs', className)}>
      <span
        className={cn(
          'inline-flex max-w-full items-center gap-0.5 rounded-sm font-semibold tabular-nums',
          size === 'sm' ? 'min-h-[18px] px-1' : 'min-h-5 px-1.5',
          tone === 'good' && 'bg-success-subtle text-success-text',
          tone === 'bad' && 'bg-danger-subtle text-danger-text',
          tone === 'neutral' && 'bg-muted text-fg-secondary',
        )}
      >
        <Icon aria-hidden className="size-3 shrink-0" strokeWidth={2.5} />
        <span className="sr-only">{missing ? 'Nothing to compare yet' : `${DELTA_WORD[direction]}${TONE_WORD[tone] ? `, ${TONE_WORD[tone]}` : ''}:`}</span>
        {missing ? 'No change yet' : text}
      </span>
      {label ? <span className="whitespace-nowrap text-fg-muted">{label}</span> : null}
    </span>
  );
}

// --- MarginPill ---------------------------------------------------------------------------

export type MarginHealth = 'healthy' | 'watch' | 'at_risk' | 'losing' | 'none';

export const MARGIN_HEALTH_LABELS: Readonly<Record<MarginHealth, string>> = {
  healthy: 'Healthy',
  watch: 'Watch',
  at_risk: 'At risk',
  losing: 'Losing money',
  none: 'Not enough data',
};

const HEALTH_STYLE: Readonly<Record<MarginHealth, { icon: LucideIcon; className: string }>> = {
  healthy: { icon: CircleCheck, className: 'bg-success-subtle text-success-text' },
  watch: { icon: Eye, className: 'bg-[var(--label-yellow-subtle)] text-[var(--label-yellow-text)]' },
  at_risk: { icon: TriangleAlert, className: 'bg-warning-subtle text-warning-text' },
  losing: { icon: TrendingDown, className: 'bg-danger-subtle text-danger-text' },
  none: { icon: CircleHelp, className: 'bg-muted text-fg-secondary' },
};

const STATUS_HEALTH: Readonly<Record<PulseStatus, MarginHealth>> = { on_track: 'healthy', heads_up: 'watch', at_risk: 'at_risk', losing: 'losing', no_data: 'none' };

/** The pill look for a job risk status. Pair it with `PULSE_STATUS_LABELS` (MarginPill does when given `status`). */
export function healthFromStatus(status: PulseStatus): MarginHealth {
  return STATUS_HEALTH[status];
}

/**
 * Health of a margin where there is no job status to read (a client, a service, a month).
 * Same lines as the job rules R1 and R2: under zero is losing money, under the floor or more than
 * the at risk gap under target is at risk, anything else under target is watch.
 */
export function marginHealth(marginBp: number | null | undefined, targetBp: number, thresholds: { marginFloorBp: number; atRiskGapBp: number } = DEFAULT_RISK_THRESHOLDS): MarginHealth {
  if (marginBp === null || marginBp === undefined || !Number.isFinite(marginBp)) return 'none';
  if (marginBp < 0) return 'losing';
  if (marginBp < thresholds.marginFloorBp || marginBp < targetBp - thresholds.atRiskGapBp) return 'at_risk';
  if (marginBp < targetBp) return 'watch';
  return 'healthy';
}

export interface MarginPillProps {
  /** Margin health. Leave it out and pass `status` for a job. */
  readonly health?: MarginHealth;
  /** A job risk status: the pill then uses the status words ("On track", "Heads up"). */
  readonly status?: PulseStatus;
  /** Margin in basis points, printed before the words: "22.4% · Watch". */
  readonly marginBp?: number | null;
  /** Replace the words. */
  readonly label?: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

export function MarginPill({ health, status, marginBp, label, size = 'md', className }: MarginPillProps) {
  const resolved: MarginHealth = health ?? (status ? healthFromStatus(status) : 'none');
  const { icon: Icon, className: tone } = HEALTH_STYLE[resolved];
  const words = label ?? (status ? PULSE_STATUS_LABELS[status] : MARGIN_HEALTH_LABELS[resolved]);
  const margin = marginBp === null || marginBp === undefined ? null : formatPercentBp(marginBp);
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-sm font-medium whitespace-nowrap', size === 'sm' ? 'h-[18px] px-1.5 text-2xs' : 'h-5 px-2 text-xs', tone, className)}>
      <Icon aria-hidden className="size-3 shrink-0" strokeWidth={2.25} />
      {margin ? (
        <>
          <span className="font-semibold tabular-nums">{margin}</span>
          <span aria-hidden className="opacity-60">
            ·
          </span>
        </>
      ) : null}
      <span className="truncate">{words}</span>
    </span>
  );
}

// --- KpiTile ------------------------------------------------------------------------------

export interface KpiTileProps {
  /** Sentence case, no colon: "Profit on jobs". */
  readonly label: string;
  /** The headline, already formatted. `null` shows the empty words. */
  readonly value: string | null;
  /** Change against the previous period. */
  readonly delta?: DeltaBadgeProps;
  /** A trend under the number. */
  readonly sparkline?: { readonly values: readonly (number | null)[]; readonly label?: string; readonly format?: ChartFormat; readonly tone?: 'accent' | 'good' | 'bad' | 'neutral' };
  /** The "how we got this" control: a popover or drawer trigger built from the same inputs. */
  readonly explain?: ReactNode;
  /** One line under the number: a MarginPill, a target, a note. */
  readonly footer?: ReactNode;
  /** Words when `value` is `null`: say what fills the tile. */
  readonly emptyText?: string;
  readonly loading?: boolean;
  /** A plain sentence when the number could not load. */
  readonly error?: string | null;
  readonly className?: string;
}

export function KpiTile({ label, value, delta, sparkline, explain, footer, emptyText = 'No data yet', loading, error, className }: KpiTileProps) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" className={cn('flex min-h-[124px] flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-4', className)}>
        <span className="sr-only">{`Loading ${label}`}</span>
        <span aria-hidden className="ks-skeleton block h-3 w-24 rounded-full" />
        <span aria-hidden className="ks-skeleton block h-7 w-32 rounded-md" />
        <span aria-hidden className="ks-skeleton block h-3 w-40 max-w-full rounded-full" />
      </div>
    );
  }
  return (
    <section aria-label={label} className={cn('@container flex min-h-[124px] min-w-0 flex-col rounded-lg border border-border-subtle bg-panel p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 min-w-0 text-xs font-medium text-fg-secondary">{label}</h3>
        {explain ? <div className="-mt-1 -mr-1.5 shrink-0">{explain}</div> : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {error}
        </p>
      ) : (
        <>
          <div className="mt-1.5 flex items-end justify-between gap-3">
            {/* A long number ("$12,345,679") steps down in size in a narrow tile so it is never cut off. */}
            <p
              title={typeof value === 'string' ? value : undefined}
              className={cn(
                'min-w-0 truncate font-semibold tracking-tight',
                value === null ? 'text-md text-fg-muted' : typeof value === 'string' && value.length > 9 ? 'text-md text-fg @[11.5rem]:text-lg @[14rem]:text-xl' : typeof value === 'string' && value.length > 7 ? 'text-lg text-fg @[11rem]:text-xl' : 'text-xl text-fg',
              )}
            >
              {value ?? emptyText}
            </p>
            {sparkline && value !== null ? <Sparkline values={sparkline.values} label={sparkline.label ?? `${label} trend`} format={sparkline.format} tone={sparkline.tone} width={88} height={30} className="mb-0.5 hidden shrink-0 @[15.5rem]:block" /> : null}
          </div>
          {(delta && value !== null) || footer ? (
            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5">
              {delta && value !== null ? <DeltaBadge {...delta} /> : null}
              {footer}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
