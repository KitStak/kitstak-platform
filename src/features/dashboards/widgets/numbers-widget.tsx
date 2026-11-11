'use client';

/**
 * Numbers (KPI) widget. Every card has the same anatomy so a row of KPIs lines up: headline
 * value, one caption row (delta, or the item count), and one bottom slot (goal bar, sparkline,
 * or an equal-height spacer).
 */
import { useId } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Tooltip, cn, toLabelColor } from '@/components/ui';
import { cssColor } from '../lib/colors';
import { describeAggregate, formatCompact, formatExact, percentChange, resolveFormat } from '../lib/format';
import type { WidgetRenderProps } from './types';

/** A sparkline only tells a story with at least three non-zero points. */
export function sparklineIsMeaningful(values: readonly number[]): boolean {
  return values.filter((value) => value !== 0).length >= 3;
}

const BOTTOM_SLOT = 'h-9 shrink-0';

function Sparkline({ values, color }: { readonly values: readonly number[]; readonly color: string }) {
  const gradientId = useId();
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 28 - ((value - min) / span) * 26;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.22 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${points.join(' ')} 100,30`} style={{ fill: `url(#${gradientId})` }} />
      <polyline
        points={points.join(' ')}
        vectorEffect="non-scaling-stroke"
        style={{ fill: 'none', stroke: color, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }}
      />
    </svg>
  );
}

function Delta({ current, previous, label }: { readonly current: number; readonly previous: number; readonly label: string }) {
  const change = percentChange(current, previous);
  if (change === null) {
    return (
      <span className="flex max-w-full min-w-0 items-center gap-1.5 text-xs text-fg-muted" data-testid="numbers-delta">
        <span className="inline-flex h-5 items-center rounded-full bg-muted px-1.5 font-medium text-fg-secondary">No prior data</span>
        <span className="truncate">{label}</span>
      </span>
    );
  }
  const up = change !== null && change > 0.05;
  const down = change !== null && change < -0.05;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const text = `${Math.abs(change) >= 100 ? Math.round(Math.abs(change)) : Math.abs(change).toFixed(1)}%`;
  return (
    <span className="flex max-w-full min-w-0 items-center gap-1.5 text-xs text-fg-muted" data-testid="numbers-delta">
      <span
        className={cn(
          'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 font-semibold tabular-nums [&_svg]:size-3.5',
          up && 'bg-success-subtle text-success-text',
          down && 'bg-danger-subtle text-danger-text',
          !up && !down && 'bg-muted text-fg-secondary',
        )}
      >
        <Icon aria-hidden />
        <span className="sr-only">{up ? 'Up' : down ? 'Down' : 'No change'}</span>
        {text}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}

export function NumbersWidget({ insight, settings, filtered }: WidgetRenderProps) {
  const aggregate = settings.valueColumnKey ? settings.aggregate : 'count';
  const format = resolveFormat(settings, insight.valueColumn, aggregate);
  const accent = cssColor(toLabelColor(settings.color, 'blue'));
  const goal = settings.goal;
  const progress = goal ? Math.min(insight.total / goal, 1) : 0;
  const exact = formatExact(insight.total, format);
  const noMatch = filtered && insight.itemCount === 0;
  const sparkValues = insight.sparkline.map((point) => point.value);
  const showSpark = !goal && settings.showSparkline && sparklineIsMeaningful(sparkValues);
  return (
    <div className="flex h-full min-h-0 flex-col [container-type:size]" data-no-match={noMatch || undefined}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 text-center">
        <Tooltip content={noMatch ? 'No items match the dashboard filters' : `${exact} · ${describeAggregate(aggregate, insight.valueColumn, insight.boards)} · ${insight.itemCount} items`}>
          <p
            tabIndex={0}
            className={cn(
              'max-w-full truncate rounded-sm font-medium leading-none tracking-[-0.02em] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              noMatch ? 'text-fg-muted' : 'text-fg',
            )}
            style={{ fontSize: 'clamp(28px, min(16cqw, 34cqh), 60px)' }}
            data-testid="numbers-value"
            aria-label={noMatch ? 'No matching items' : exact}
          >
            {noMatch ? '—' : formatCompact(insight.total, format)}
          </p>
        </Tooltip>
        {noMatch ? (
          <span className="text-xs text-fg-muted">No matching items</span>
        ) : insight.comparison ? (
          <Delta current={insight.comparison.current} previous={insight.comparison.previous} label={insight.comparison.label} />
        ) : (
          <span className="text-xs text-fg-muted">{insight.itemCount.toLocaleString('en-US')} {insight.itemCount === 1 ? 'item' : 'items'}</span>
        )}
      </div>
      <div className={cn(BOTTOM_SLOT, 'mt-2 hidden flex-col justify-end [@container(min-height:116px)]:flex')}>
        {goal && !noMatch ? (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-fg-muted">
              <span>Goal {formatCompact(goal, format)}</span>
              <span className="font-medium tabular-nums text-fg-secondary">{Math.round((insight.total / goal) * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to goal">
              <div className="h-full rounded-full transition-[width] duration-[var(--duration-slower)] ease-out" style={{ width: `${progress * 100}%`, background: accent }} />
            </div>
          </div>
        ) : showSpark && !noMatch ? (
          <Sparkline values={sparkValues} color={accent} />
        ) : null}
      </div>
    </div>
  );
}
