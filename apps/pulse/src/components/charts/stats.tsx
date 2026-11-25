'use client';
/**
 * Small stat helpers: KpiTile (one headline number with its change, trend and a "how we got
 * this" slot), DeltaBadge (a change with an arrow and a good or bad tone) and MarginPill (margin
 * health as icon plus words, so it reads the same for color blind people).
 */
import type { ReactNode } from 'react';
import { CircleCheck, CircleHelp, Eye, TrendingDown, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Delta, Pill, StatTile, type DeltaProps, type PillTone } from '@kitstak/ui/dashboard';
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

/** Five pill tones, no more (docs/design/UI-CLEANUP.md). Watch is neutral: the eye and the word carry it. */
const HEALTH_STYLE: Readonly<Record<MarginHealth, { icon: LucideIcon; tone: PillTone }>> = {
  healthy: { icon: CircleCheck, tone: 'positive' },
  watch: { icon: Eye, tone: 'neutral' },
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

// --- KpiTile ------------------------------------------------------------------------------

export interface KpiTileProps {
  /** Sentence case, no colon: "Profit on jobs". */
  readonly label: string;
  /** The headline, already formatted. `null` shows the empty words. */
  readonly value: string | null;
  /** Change against the previous period. */
  readonly delta?: DeltaBadgeProps;
  /** True while the number to compare with is still loading: the tile keeps room for the change so it does not grow later. */
  readonly deltaPending?: boolean;
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
  /**
   * Where the number goes: the list or report it sums up. On Home and other summary pages every
   * tile needs one (no dead ends). Leave it out only on the page the number already explains.
   */
  readonly href?: string | null;
  /** Leave out the "vs before" words when the page header already says what the change is against. */
  readonly hideDeltaLabel?: boolean;
  readonly className?: string;
}

/**
 * One headline number, drawn by the shared StatTile (`@kitstak/ui/dashboard`) so it looks the same
 * as every KitStak app. The "how we got this" control sits in the corner, outside the tile link.
 */
export function KpiTile({ label, value, delta, deltaPending, sparkline, explain, footer, emptyText = 'No data yet', loading, error, href = null, hideDeltaLabel = false, className }: KpiTileProps) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" data-testid="kpi-tile" className={cn('ks-dash-stat min-h-[112px]', className)}>
        <span className="ks-dash-stat-link">
          <span className="sr-only">{`Loading ${label}`}</span>
          <span aria-hidden className="ks-skeleton block h-3 w-24 rounded-full" />
          <span aria-hidden className="ks-skeleton mt-1 block h-7 w-32 rounded-md" />
          <span aria-hidden className="ks-skeleton mt-1 block h-3 w-40 max-w-full rounded-full" />
        </span>
      </div>
    );
  }
  if (error) {
    return (
      <StatTile
        data-testid="kpi-tile"
        className={className}
        label={label}
        href={null}
        explain={explain}
        value={
          <span role="alert" className="text-sm font-normal whitespace-normal text-danger-text">
            {error}
          </span>
        }
      />
    );
  }
  const shown = value !== null;
  const pending = !delta && deltaPending && shown ? <span aria-hidden data-testid="kpi-delta-pending" className="ks-skeleton inline-block h-4 w-32 max-w-full rounded-sm align-middle" /> : null;
  return (
    <StatTile
      data-testid="kpi-tile"
      className={cn('min-h-[112px]', className)}
      label={label}
      href={href}
      explain={explain}
      value={shown ? <span title={value}>{value}</span> : <span className="text-md font-medium text-fg-muted">{emptyText}</span>}
      trend={sparkline && shown ? <Sparkline values={sparkline.values} label={sparkline.label ?? `${label} trend`} format={sparkline.format} tone={sparkline.tone} width={88} height={28} /> : undefined}
      delta={delta && shown ? toDelta(delta) : undefined}
      deltaLabel={delta && shown && !hideDeltaLabel ? delta.label : undefined}
      caption={
        pending || footer ? (
          <>
            {pending}
            {footer}
          </>
        ) : undefined
      }
    />
  );
}
