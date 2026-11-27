'use client';
/**
 * Small stat helpers: fillers for the shared StatTile (value, sparkline, loading), DeltaBadge (a
 * change with an arrow and a good or bad tone) and MarginPill (margin health as icon plus words, so
 * it reads the same for color blind people).
 */
import type { ReactNode } from 'react';
import { CircleCheck, CircleHelp, Eye, TrendingDown, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Delta, Pill, type DeltaProps, type PillTone } from '@kitstak/ui/dashboard';
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

/** The shared change mark (colored text and an arrow, no chip) for a Pulse change. */
export function toDelta({ delta, text, goodWhen = 'up' }: Pick<DeltaBadgeProps, 'delta' | 'text' | 'goodWhen'>): DeltaProps {
  const missing = delta === null || delta === undefined;
  // A change too small to show ("0 points", "$0") reads as no change: no arrow and no good or bad color.
  const rounded = missing || /[1-9]/.test(text) ? delta : 0;
  const direction = deltaDirection(rounded);
  const tone = deltaTone(rounded, goodWhen);
  return {
    text: missing ? 'No change yet' : text,
    direction,
    tone,
    srLabel: missing ? 'Nothing to compare yet' : `${DELTA_WORD[direction]}${TONE_WORD[tone] ? `, ${TONE_WORD[tone]}` : ''}:`,
  };
}

export function DeltaBadge({ delta, text, goodWhen = 'up', label, size = 'md', className }: DeltaBadgeProps) {
  return (
    <span className={cn('inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5', size === 'sm' ? 'text-2xs' : 'text-xs', className)}>
      <Delta {...toDelta({ delta, text, goodWhen })} />
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

/**
 * Five pill tones, no more (docs/design/UI-CLEANUP.md). Watch and at risk share the caution tone
 * (both "might go wrong"); the eye or the triangle and the words tell them apart.
 */
const HEALTH_STYLE: Readonly<Record<MarginHealth, { icon: LucideIcon; tone: PillTone }>> = {
  healthy: { icon: CircleCheck, tone: 'positive' },
  watch: { icon: Eye, tone: 'caution' },
  at_risk: { icon: TriangleAlert, tone: 'caution' },
  losing: { icon: TrendingDown, tone: 'critical' },
  none: { icon: CircleHelp, tone: 'neutral' },
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

/** The shared pill (one size everywhere, so `size` is kept only for old call sites). */
export function MarginPill({ health, status, marginBp, label, className }: MarginPillProps) {
  const resolved: MarginHealth = health ?? (status ? healthFromStatus(status) : 'none');
  const { icon: Icon, tone } = HEALTH_STYLE[resolved];
  const words = label ?? (status ? PULSE_STATUS_LABELS[status] : MARGIN_HEALTH_LABELS[resolved]);
  const margin = marginBp === null || marginBp === undefined ? null : formatPercentBp(marginBp);
  return (
    <Pill tone={tone} icon={<Icon strokeWidth={2.25} />} className={className}>
      {margin ? (
        <>
          <span className="font-semibold tabular-nums">{margin}</span>
          <span aria-hidden className="opacity-60">
            {' · '}
          </span>
        </>
      ) : null}
      {words}
    </Pill>
  );
}

// --- StatTile helpers -----------------------------------------------------------------------
// Headline numbers are the shared StatTile inside a StatRow (`@kitstak/ui/dashboard`). These small
// pieces fill its slots the Pulse way: quiet empty words, a sparkline in the data color, and a
// skeleton of the same size while the number loads.

/** The value slot: the number, or quiet words that say what fills the tile. */
export function statValue(value: string | null, emptyText = 'No data yet'): ReactNode {
  return value !== null ? <span title={value}>{value}</span> : <span className="text-md font-medium text-fg-muted">{emptyText}</span>;
}

export interface StatSparklineProps {
  readonly values: readonly (number | null)[];
  /** Read out with the trend summary: "Revenue trend". */
  readonly label: string;
  readonly format?: ChartFormat;
  readonly tone?: 'accent' | 'good' | 'bad' | 'neutral';
}

/** A trend for the StatTile `trend` slot, sized for a tile. */
export function StatSparkline({ values, label, format, tone }: StatSparklineProps) {
  return <Sparkline values={values} label={label} format={format} tone={tone} width={88} height={28} />;
}

/** Keeps room for the change while the number to compare with loads, so the tile does not grow later. */
export function DeltaPending() {
  return <span aria-hidden data-testid="kpi-delta-pending" className="ks-skeleton inline-block h-4 w-32 max-w-full rounded-sm align-middle" />;
}

/** A tile while its number loads: the StatTile frame with a skeleton, so nothing moves when it lands. */
export function StatTileLoading({ label, className, ...rest }: { readonly label: string; readonly className?: string; readonly 'data-testid'?: string }) {
  return (
    <div role="status" aria-busy="true" data-testid={rest['data-testid']} className={cn('ks-dash-stat min-h-[104px]', className)}>
      <span className="ks-dash-stat-link">
        <span className="sr-only">{`Loading ${label}`}</span>
        <span aria-hidden className="ks-skeleton block h-3 w-24 rounded-full" />
        <span aria-hidden className="ks-skeleton mt-1 block h-7 w-32 rounded-md" />
        <span aria-hidden className="ks-skeleton mt-1 block h-3 w-40 max-w-full rounded-full" />
      </span>
    </div>
  );
}
