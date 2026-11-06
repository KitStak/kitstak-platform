'use client';
import { ProgressBar, Skeleton, cn } from '@/components/ui';
import type { AutomationUsageDto } from '@/server/services/contracts/automations-center';
import { formatPercent, summarizeUsage } from '../model/usage';

export function UsageMeter({
  usage,
  compact,
  className,
}: {
  readonly usage: AutomationUsageDto | undefined;
  readonly compact?: boolean;
  readonly className?: string;
}) {
  if (!usage) {
    return (
      // Same rows and heights as the loaded meter so nothing shifts when data arrives.
      <div className={cn('flex flex-col gap-1.5', className)} aria-busy="true">
        <div className={cn('flex items-center justify-between gap-2', compact ? 'h-5' : 'h-8')}>
          <Skeleton width={compact ? '55%' : 160} height={compact ? 12 : 24} />
          {!compact ? <Skeleton width={36} height={14} /> : null}
        </div>
        <Skeleton height={compact ? 4 : 6} rounded="full" />
        <div className="flex h-4 items-center">
          <Skeleton width="50%" height={10} />
        </div>
      </div>
    );
  }
  const summary = summarizeUsage({
    used: usage.runsThisMonth,
    allowance: usage.allowance,
    dayOfMonth: usage.dayOfMonth,
    daysInMonth: usage.daysInMonth,
  });
  return (
    <div
      className={cn('flex flex-col gap-1.5', className)}
      data-testid="usage-meter"
      data-tone={summary.tone}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn('font-semibold text-fg tabular-nums', compact ? 'text-sm' : 'font-heading text-2xl')}
        >
          {summary.used.toLocaleString()}
          <span className={cn('font-normal text-fg-secondary', compact ? 'text-xs' : 'text-base')}>
            {' '}
            / {summary.allowance.toLocaleString()} runs
          </span>
        </span>
        {!compact ? (
          <span className="text-sm text-fg-secondary tabular-nums">{formatPercent(summary.percent)}</span>
        ) : null}
      </div>
      <ProgressBar
        value={summary.percent}
        label="Automation runs used this month"
        tone={summary.tone}
        size={compact ? 'sm' : 'md'}
      />
      <p
        className={cn(
          'text-xs',
          summary.tone === 'danger'
            ? 'text-danger-text'
            : summary.tone === 'warning'
              ? 'text-warning-text'
              : 'text-fg-secondary',
        )}
      >
        {summary.tone === 'danger'
          ? 'Monthly allowance reached.'
          : summary.forecastOver
            ? `On pace for ${summary.forecast.toLocaleString()} this month, above the allowance.`
            : `On pace for ${summary.forecast.toLocaleString()} by month end.`}
      </p>
    </div>
  );
}
