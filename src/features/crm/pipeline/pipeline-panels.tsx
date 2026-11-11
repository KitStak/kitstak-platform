'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CalendarX2, Clock3, Target } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState, Tooltip, cn } from '@/components/ui';
import { routes } from '@/features/shell/routes';
import type { RepRowDto, RiskDealDto, StageVelocityDto } from '@/server/services/crm-contracts';
import { formatDay, formatExactMoney, formatMoney, formatPercent, noun } from '../lib/format';
import { Meter, StagePill, UserChip } from '../components/crm-ui';

export function QuotaTable({
  reps,
  currency,
  canEdit,
  onSetQuotas,
  hasPeriodQuota,
}: {
  readonly reps: readonly RepRowDto[];
  readonly currency: string;
  readonly canEdit: boolean;
  readonly onSetQuotas: () => void;
  readonly hasPeriodQuota: boolean;
}) {
  if (reps.length === 0) {
    return <EmptyState size="sm" illustration="search" title="No reps in this view" description="No deals match the current filters." />;
  }
  const anyQuota = reps.some((rep) => rep.quota !== null);
  return (
    <div className="flex flex-col gap-3" data-testid="crm-quota">
      {!anyQuota && hasPeriodQuota ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary-subtle px-3 py-2 text-sm text-primary-text">
          <span className="flex items-center gap-2">
            <Target aria-hidden className="size-4" />
            Set quarterly quotas to track attainment.
          </span>
          {canEdit ? (
            <Button size="xs" variant="tertiary" onClick={onSetQuotas}>
              Set quotas
            </Button>
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {reps.map((rep) => {
          const attainment = rep.attainment;
          const tone = attainment === null ? 'var(--primary)' : attainment >= 1 ? 'var(--success)' : attainment >= 0.6 ? 'var(--primary)' : 'var(--warning)';
          return (
            <li key={rep.user.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={rep.user.name} src={rep.user.image} size="sm" colorKey={rep.user.id} />
                <span className="truncate text-base font-medium text-fg">{rep.user.name}</span>
                <span className="hidden text-xs text-fg-muted sm:inline">
                  {rep.openCount} open · wtd {formatMoney(rep.weighted, currency)}
                </span>
              </div>
              <div className="text-right text-sm tabular-nums">
                <span className="font-semibold text-fg">{formatMoney(rep.won, currency)}</span>
                <span className="text-fg-muted"> / {rep.quota !== null ? formatMoney(rep.quota, currency) : 'no quota'}</span>
              </div>
              {rep.quota !== null ? (
                <>
                  <Meter
                    value={rep.won}
                    max={rep.quota}
                    color={tone}
                    label={`${rep.user.name}: ${formatPercent(attainment)} of quota`}
                  />
                  <span
                    className={cn(
                      'w-12 text-right text-sm font-semibold tabular-nums',
                      attainment !== null && attainment >= 1 ? 'text-success-text' : 'text-fg',
                    )}
                  >
                    {formatPercent(attainment)}
                  </span>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AtRiskList({
  deals,
  currency,
  orgSlug,
  boardId,
  staleDays,
  term,
  limit = 5,
}: {
  readonly deals: readonly RiskDealDto[];
  readonly currency: string;
  readonly orgSlug: string;
  readonly boardId: string;
  readonly staleDays: number;
  readonly term: string;
  /** Rows shown before "View all" (no inner scroll area inside the scrolling page). */
  readonly limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (deals.length === 0) {
    return (
      <EmptyState
        size="sm"
        illustration="favorites"
        title="Nothing at risk"
        description={`Every open ${noun(term)} had activity in the last ${staleDays} days and is on schedule.`}
      />
    );
  }
  const shown = expanded ? deals : deals.slice(0, limit);
  return (
    <div className="flex flex-col gap-2">
    <ul className="-mx-2 flex flex-col" data-testid="crm-at-risk">
      {shown.map((deal) => (
        <li key={deal.id}>
          <Link
            href={routes.item(orgSlug, boardId, deal.id)}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 outline-none transition-colors duration-[var(--duration-instant)] hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          >
            <span className="truncate text-base font-medium text-fg" title={deal.name}>
              {deal.name}
            </span>
            <span className="text-right text-base font-semibold tabular-nums text-fg">
              <Tooltip content={formatExactMoney(deal.value, currency)}>
                <span>{formatMoney(deal.value, currency)}</span>
              </Tooltip>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <StagePill label={deal.stage} className="h-5 min-w-0 text-xs" />
              {deal.reasons.includes('stale') ? (
                <Badge tone="warning" icon={<Clock3 aria-hidden />}>
                  {deal.daysSinceActivity !== null ? `${deal.daysSinceActivity}d no activity` : 'No activity'}
                </Badge>
              ) : null}
              {deal.reasons.includes('overdue') ? (
                <Badge tone="danger" icon={<CalendarX2 aria-hidden />}>
                  Close date passed {formatDay(deal.closeDate)}
                </Badge>
              ) : null}
            </span>
            <span className="justify-self-end">
              <UserChip user={deal.owner} size="xs" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
      {deals.length > limit ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          data-testid="crm-at-risk-toggle"
        >
          {expanded ? 'Show fewer' : `View all ${deals.length}`}
        </Button>
      ) : null}
    </div>
  );
}

export function VelocityStrip({ stages }: { readonly stages: readonly StageVelocityDto[] }) {
  const slowest = stages.reduce<StageVelocityDto | null>(
    (worst, stage) => ((stage.avgDays ?? -1) > (worst?.avgDays ?? -1) ? stage : worst),
    null,
  );
  const max = Math.max(1, ...stages.map((stage) => Math.max(stage.avgDays ?? 0, stage.currentAvgDays ?? 0)));
  if (stages.length === 0) return <p className="text-sm text-fg-muted">No open stages on this board.</p>;
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="crm-velocity">
      {stages.map((stage) => {
        const isSlowest = slowest?.label.id === stage.label.id && (stage.avgDays ?? 0) > 0;
        return (
          <li
            key={stage.label.id}
            className={cn(
              'flex flex-col gap-2 rounded-md border bg-panel p-3',
              isSlowest ? 'border-warning-accent' : 'border-border-subtle',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <StagePill label={stage.label} className="h-5 text-xs" />
              {isSlowest ? <Badge tone="warning">Bottleneck</Badge> : null}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-semibold tabular-nums text-fg">
                {stage.avgDays !== null ? stage.avgDays.toFixed(stage.avgDays < 10 ? 1 : 0) : '—'}
              </span>
              <span className="text-sm text-fg-secondary">avg days in stage</span>
            </div>
            <Meter value={stage.avgDays ?? 0} max={max} color={isSlowest ? 'var(--warning)' : 'var(--primary)'} />
            <dl className="grid grid-cols-2 gap-x-3 text-xs">
              <div className="flex flex-col">
                <dt className="text-fg-muted">Here now</dt>
                <dd className="font-medium tabular-nums text-fg">
                  {stage.currentCount}
                  {stage.currentAvgDays !== null ? <span className="font-normal text-fg-muted"> · {Math.round(stage.currentAvgDays)}d old</span> : null}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-fg-muted">Moves measured</dt>
                <dd className="font-medium tabular-nums text-fg">{stage.transitions}</dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ol>
  );
}
