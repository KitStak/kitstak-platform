'use client';
import { ChevronDown } from 'lucide-react';
import { Tooltip, labelColorStyle, toLabelColor } from '@/components/ui';
import type { FunnelStageDto } from '@/server/services/crm-contracts';
import { formatExactMoney, formatMoney, formatPercent, noun } from '../lib/format';
import { StagePill } from '../components/crm-ui';

/** Bar length (0–100%) for a stage: proportional to count, a sliver for any non-zero count. */
export function funnelWidth(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  return Math.max(3, (count / maxCount) * 100);
}

/**
 * Stage funnel: stage name on the left, a left-aligned bar on a stage-tinted track (lengths are
 * comparable), value + weighted value on the right, and the step conversion between stages.
 * With no deals in the period it collapses to the stage list and a short note.
 */
export function PipelineFunnel({
  stages,
  currency,
  term,
}: {
  readonly stages: readonly FunnelStageDto[];
  readonly currency: string;
  readonly term: string;
}) {
  const open = stages.filter((stage) => stage.kind === 'open');
  const closed = stages.filter((stage) => stage.kind !== 'open');
  const maxCount = Math.max(0, ...open.map((stage) => stage.count));
  const isEmpty = stages.every((stage) => stage.count === 0);

  if (isEmpty) {
    return (
      <div className="flex flex-col gap-3" data-testid="crm-funnel" data-empty="true">
        <p className="text-base text-fg-secondary">No open {noun(term, 2)} in this period.</p>
        <ul className="flex flex-wrap gap-2" aria-label="Pipeline stages">
          {stages.map((stage) => (
            <li key={stage.label.id}>
              <StagePill label={stage.label} className="h-6 text-xs" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="crm-funnel">
      <ol className="flex flex-col" aria-label="Open pipeline stages">
        {open.map((stage, index) => {
          const width = funnelWidth(stage.count, maxCount);
          const inside = width >= 78;
          return (
            <li key={stage.label.id} className="flex flex-col">
              {index > 0 ? (
                <div
                  className="flex h-6 items-center gap-1 pl-[calc(112px+0.75rem)] text-xs text-fg-muted sm:pl-[calc(136px+0.75rem)]"
                  aria-label={`Conversion from previous stage ${formatPercent(stage.conversion)}`}
                >
                  <ChevronDown aria-hidden className="size-3.5" />
                  <span className="font-medium tabular-nums text-fg-secondary">{formatPercent(stage.conversion)}</span>
                  <span className="hidden sm:inline">moved on</span>
                </div>
              ) : null}
              <div className="grid grid-cols-[112px_1fr_auto] items-center gap-3 sm:grid-cols-[136px_1fr_176px]">
                <span className="flex min-w-0 items-center gap-2" style={labelColorStyle(toLabelColor(stage.label.color))}>
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[var(--lc-bg)]" />
                  <span className="truncate text-sm font-medium text-fg" title={stage.label.name}>
                    {stage.label.name}
                  </span>
                </span>
                <Tooltip
                  side="right"
                  align="center"
                  content={`${stage.count} ${noun(term, stage.count)} · ${formatExactMoney(stage.value, currency)} · ${stage.probability}% probability`}
                >
                  <button
                    type="button"
                    style={labelColorStyle(toLabelColor(stage.label.color))}
                    className="relative h-7 w-full overflow-hidden rounded-md bg-[var(--lc-subtle)] outline-none transition-[filter] duration-[var(--duration-fast)] hover:brightness-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    aria-label={`${stage.label.name}: ${stage.count} ${noun(term, stage.count)}, ${formatExactMoney(stage.value, currency)}, ${stage.probability}% probability`}
                    data-testid="crm-funnel-bar"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 rounded-md bg-[var(--lc-bg)] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-enter)]"
                      style={{ width: `${width}%` }}
                    />
                    <span
                      aria-hidden
                      className="absolute inset-y-0 flex items-center text-sm font-semibold tabular-nums"
                      style={
                        inside
                          ? { right: `calc(${100 - width}% + 8px)`, color: 'var(--lc-fg)' }
                          : { left: `calc(${width}% + 8px)`, color: 'var(--lc-text)' }
                      }
                    >
                      {stage.count}
                    </span>
                  </button>
                </Tooltip>
                <div className="flex flex-col items-end text-right leading-tight">
                  <span className="text-base font-semibold tabular-nums text-fg">{formatMoney(stage.value, currency)}</span>
                  <span className="text-xs tabular-nums text-fg-muted">
                    wtd {formatMoney(stage.weighted, currency)} · {stage.probability}%
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {closed.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 border-t border-border-subtle pt-4 sm:grid-cols-2">
          {closed.map((stage) => (
            <div key={stage.label.id} className="flex items-center justify-between gap-3 rounded-md bg-sunken px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <StagePill label={stage.label} />
                <span className="text-sm tabular-nums text-fg-secondary">
                  {stage.count} {noun(term, stage.count)}
                </span>
              </div>
              <span className="text-base font-semibold tabular-nums text-fg">{formatMoney(stage.value, currency)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
