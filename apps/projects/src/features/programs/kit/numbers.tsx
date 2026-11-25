'use client';
/**
 * Number atoms: MoneyText, UnitText, QtyProgress, RunRing and RunLine (docs/programs/SPEC.md 5).
 * Money renders only through `formatCents` and disappears when money is hidden (M8). Every number
 * has a word next to it ("5 of 8 builds", never "5/8").
 */
import Link from 'next/link';
import { Check } from 'lucide-react';
import { formatCents, formatQty, formatUnitPrice, fromScaled, unitLabel } from '@kitstak/programs-engine';
import { Badge, ProgressBar, cn } from '@/components/ui';
import type { RunDTO, UnitLabel } from '@/lib/program-types';
import { RUN_STATE_TEXT, RUN_STATE_TONE, dayLabel, doneOfText, qtyOfText, qtyPercent, qtyTone, scaledQty } from './format';

export interface MoneyTextProps {
  /** Whole cents as a decimal string (or bigint). Null means hidden or unknown. */
  readonly cents: string | bigint | null | undefined;
  /** When true nothing renders (or `hiddenText` when given). */
  readonly hidden?: boolean;
  readonly hiddenText?: string;
  /** Show cents (default true: program money is exact to the cent). */
  readonly showCents?: boolean;
  readonly compact?: boolean;
  /** Prefix "+" on positive amounts (deltas). */
  readonly signed?: boolean;
  /** Color negatives danger and positives success (deltas). */
  readonly toneBySign?: boolean;
  readonly className?: string;
}

/** Tabular money text. Never computes: formats the engine's cents. */
export function MoneyText({ cents, hidden, hiddenText, showCents = true, compact, signed, toneBySign, className }: MoneyTextProps) {
  if (hidden || cents === null || cents === undefined) return hiddenText ? <span className={cn('text-fg-muted', className)}>{hiddenText}</span> : null;
  const value = typeof cents === 'bigint' ? cents : BigInt(cents);
  const text = formatCents(value, { cents: showCents, compact });
  const positive = value > BigInt(0);
  const negative = value < BigInt(0);
  return (
    <span className={cn('tabular-nums', toneBySign && positive && 'text-success-text', toneBySign && negative && 'text-danger-text', className)} data-money="">
      {signed && positive ? '+' : ''}
      {text}
    </span>
  );
}

/** A unit price ("$1.95", "$1.8525") or "No price". */
export function UnitPriceText({ price, hidden, className }: { readonly price: string | null | undefined; readonly hidden?: boolean; readonly className?: string }) {
  if (hidden) return null;
  return <span className={cn('tabular-nums', !price && 'text-fg-muted', className)}>{formatUnitPrice(price ?? null)}</span>;
}

/** "1,200 kits" with the unit word from the program. */
export function UnitText({ qty, unit, className, bare }: { readonly qty: string; readonly unit: UnitLabel; readonly className?: string; readonly bare?: boolean }) {
  return <span className={cn('tabular-nums', className)}>{bare ? formatQty(qty) : unitLabel(qty, unit)}</span>;
}

export interface QtyProgressProps {
  readonly built: string;
  readonly planned: string;
  readonly unit: UnitLabel;
  readonly size?: 'sm' | 'md';
  /** Hide the text and show only the bar. */
  readonly barOnly?: boolean;
  readonly className?: string;
}

/** "60 of 100 kits" with a small bar: success when full, warning when over plan. */
export function QtyProgress({ built, planned, unit, size = 'sm', barOnly, className }: QtyProgressProps) {
  const text = qtyOfText(built, planned, unit);
  const tone = qtyTone(built, planned);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)} data-testid="qty-progress">
      {!barOnly ? <span className={cn('shrink-0 tabular-nums', size === 'sm' ? 'text-xs' : 'text-sm', tone === 'warning' ? 'text-warning-text' : 'text-fg-secondary')}>{text}</span> : null}
      <ProgressBar value={qtyPercent(built, planned)} size="sm" tone={tone} label={text} className={cn(size === 'sm' ? 'w-16' : 'w-24', 'shrink-0')} />
    </span>
  );
}

export interface RunRingProps {
  readonly done: number;
  readonly total: number;
  /** Diameter in px. */
  readonly size?: number;
  /** Show "5/8" style count inside? No: rings show a check when done, else nothing inside; the text sits beside. */
  readonly className?: string;
  readonly label?: string;
}

/** A done ratio ring. Text always sits next to it ("5 of 8 done"); the ring adds a glance. */
export function RunRing({ done, total, size = 20, className, label }: RunRingProps) {
  const stroke = Math.max(2, Math.round(size / 8));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const full = total > 0 && done >= total;
  const color = full ? 'var(--success)' : done > 0 ? 'var(--info)' : 'var(--border-strong)';
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} role="img" aria-label={label ?? doneOfText(done, total)} data-testid="run-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-subtle)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          className="transition-[stroke-dasharray] duration-[var(--duration-normal)] ease-out"
        />
      </svg>
      {full ? <Check aria-hidden className="absolute text-success-text" style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={3} /> : null}
    </span>
  );
}

export interface RunLineProps {
  readonly run: Pick<RunDTO, 'id' | 'date' | 'name' | 'state' | 'builds' | 'done' | 'plannedUnits' | 'builtUnits' | 'revenueCents'>;
  readonly unit: UnitLabel;
  /** Show the day first ("Wed Nov 25 · ..."). */
  readonly withDate?: boolean;
  readonly showState?: boolean;
  readonly moneyHidden?: boolean;
  readonly href?: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/** One run in one line: ring, "Wed Nov 25 · Weekday glove run · 560 of 800 kits · 5 of 8 done", state, revenue. */
export function RunLine({ run, unit, withDate = true, showState = true, moneyHidden, href, size = 'md', className }: RunLineProps) {
  const name = run.name;
  const body = (
    <>
      <RunRing done={run.done} total={run.builds} size={size === 'sm' ? 16 : 20} label={`${run.done} of ${run.builds} builds done in ${name}`} />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
        {withDate ? <span className="shrink-0 font-medium text-fg">{dayLabel(run.date)}</span> : null}
        {withDate ? <span aria-hidden className="text-fg-muted">·</span> : null}
        <span className={cn('min-w-0 truncate', withDate ? 'text-fg-secondary' : 'font-medium text-fg')} title={name}>
          {name}
        </span>
        <span aria-hidden className="text-fg-muted">·</span>
        <span className="shrink-0 text-fg-secondary tabular-nums">{qtyOfText(run.builtUnits, run.plannedUnits, unit)}</span>
        <span aria-hidden className="text-fg-muted">·</span>
        <span className="shrink-0 text-fg-secondary tabular-nums">{doneOfText(run.done, run.builds, 'done')}</span>
      </span>
      {showState ? (
        <Badge tone={RUN_STATE_TONE[run.state]} size="sm" className="shrink-0">
          {RUN_STATE_TEXT[run.state]}
        </Badge>
      ) : null}
      {!moneyHidden && run.revenueCents !== null ? <MoneyText cents={run.revenueCents} className="shrink-0 text-xs font-medium text-fg" /> : null}
    </>
  );
  const classes = cn('flex min-w-0 items-center gap-2', size === 'sm' ? 'text-xs' : 'text-sm', className);
  if (href) {
    return (
      <Link href={href} className={cn(classes, 'rounded-sm outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus')} data-testid={`run-line-${run.id}`}>
        {body}
      </Link>
    );
  }
  return (
    <div className={classes} data-testid={`run-line-${run.id}`}>
      {body}
    </div>
  );
}

export interface OutputSparklineProps {
  /** One point per day, oldest first (the program list sends the last 30 days). */
  readonly points: readonly { readonly date: string; readonly units: string }[];
  readonly unit: UnitLabel;
  readonly height?: number;
  readonly className?: string;
}

/** Daily output as small bars, today's bar in full ink. The label says the total and the best day. */
export function OutputSparkline({ points, unit, height = 28, className }: OutputSparklineProps) {
  const values = points.map((point) => scaledQty(point.units));
  const max = values.reduce((best, value) => (value > best ? value : best), BigInt(0));
  const total = values.reduce((sum, value) => sum + value, BigInt(0));
  const bestIndex = values.findIndex((value) => value === max);
  const label =
    max > BigInt(0)
      ? `Last ${points.length} days: ${unitLabel(fromScaled(total, 3), unit)} built. Best day ${dayLabel(points[bestIndex]?.date ?? '')} with ${unitLabel(fromScaled(max, 3), unit)}.`
      : `Nothing built in the last ${points.length} days.`;
  const gap = 2;
  const width = points.length * 6;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn('block w-full', className)} style={{ height }} data-testid="output-sparkline">
      <title>{label}</title>
      {values.map((value, index) => {
        const h = max > BigInt(0) ? Math.max(value > BigInt(0) ? 2 : 1, Number((value * BigInt(1000)) / max) / 1000 * height) : 1;
        const last = index === values.length - 1;
        return <rect key={points[index]?.date ?? index} x={index * 6} y={height - h} width={6 - gap} height={h} rx={1} fill={last ? 'var(--logo-ink)' : value > BigInt(0) ? 'var(--chart-1, var(--info))' : 'var(--border-subtle)'} opacity={last || value === BigInt(0) ? 1 : 0.55} />;
      })}
    </svg>
  );
}
