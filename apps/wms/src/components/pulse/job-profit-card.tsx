'use client';

/**
 * "Job profit" on a work order page: the KitStak Pulse job that tracks this work order, with
 * its health, how far along it is, revenue, cost, profit and margin, and plan against actual for
 * labor and materials. "Log production" opens the Pulse daily log on this job. With no job yet,
 * "Create Pulse job from this work order" opens the Pulse new job form, filled in from here.
 *
 * Numbers come from the WMS server, which reads Pulse's own rollups through
 * @kitstak/pulse-bridge. Nothing is worked out in this file. Renders nothing when Pulse is not
 * licensed, not installed, or this person has no Pulse role. People who may not see money in
 * Pulse get units, hours and health only.
 */
import * as React from 'react';
import { ArrowUpRight, ClipboardPen, EyeOff, Plus } from 'lucide-react';
import { formatCents, formatMarginBp, formatQuantity, statusTone } from '@kitstak/pulse-bridge/format';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import type { WorkOrderPulseDto, WorkOrderPulseJob } from '@/server/pulse/bridge';
import { PulseLink, PulseMark, PulseStatusPill } from './pulse-shared';

function Figure({ label, value, tone }: { readonly label: string; readonly value: string; readonly tone?: 'danger' }) {
  return (
    <div className="flex min-w-0 flex-col rounded-md bg-sunken px-2.5 py-2">
      <dt className="order-2 truncate text-2xs text-faint">{label}</dt>
      <dd className={cn('order-1 truncate text-sm font-semibold tabular-nums', tone === 'danger' ? 'text-danger' : 'text-foreground')}>{value}</dd>
    </div>
  );
}

/** Plan against actual for one cost line. The bar only places two stored amounts side by side. */
function PlanBar({ label, planCents, actualCents }: { readonly label: string; readonly planCents: number | null; readonly actualCents: number | null }) {
  if (planCents === null || actualCents === null || planCents <= 0) return null;
  const over = actualCents > planCents;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-secondary">{label}</span>
        <span className="tabular-nums text-body">
          <span className={cn('font-medium', over && 'text-danger')}>{formatCents(actualCents)}</span> of {formatCents(planCents)} planned
        </span>
      </div>
      <ProgressBar value={actualCents} max={planCents} size="sm" tone={over ? 'danger' : 'primary'} label={`${label}: ${formatCents(actualCents)} spent of ${formatCents(planCents)} planned`} />
    </div>
  );
}

function JobBlock({ job, data }: { readonly job: WorkOrderPulseJob; readonly data: WorkOrderPulseDto }) {
  const done = job.pctCompleteBp === null ? null : Math.round(job.pctCompleteBp / 100);
  const tone = statusTone(job.risk);
  const open = job.status !== 'completed' && job.status !== 'cancelled';
  return (
    <div className="flex flex-col gap-3" data-testid="pulse-job">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <a href={job.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground hover:underline" title={job.name}>
          <span className="tabular-nums text-secondary">{job.number}</span> {job.name}
        </a>
        <PulseStatusPill risk={job.risk} fallback={job.statusLabel} />
      </div>
      <div>
        <ProgressBar
          value={done ?? 0}
          size="sm"
          tone={tone === 'bad' ? 'danger' : tone === 'warn' ? 'warning' : 'primary'}
          label={`${job.number} is ${done ?? 0} percent done`}
        />
        <p className="mt-1 text-xs tabular-nums text-secondary">
          {formatQuantity(job.unitsGood)} of {formatQuantity(job.plannedUnits)} {job.unitLabel} logged in Pulse
          {done !== null ? ` (${done}%)` : ''} · {formatQuantity(job.hours)} hours
        </p>
      </div>
      {data.moneyHidden ? (
        <p className="flex items-center gap-2 rounded-md bg-sunken px-2.5 py-2 text-xs text-secondary" data-testid="pulse-money-hidden">
          <EyeOff aria-hidden className="size-3.5 shrink-0" />
          Your Pulse role does not include money, so revenue, cost and profit are hidden here.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2">
            <Figure label="Revenue so far" value={formatCents(job.revenueCents)} />
            <Figure label="Cost so far" value={formatCents(job.costCents)} />
            <Figure label="Profit so far" value={formatCents(job.profitCents)} tone={(job.profitCents ?? 0) < 0 ? 'danger' : undefined} />
            <Figure label={job.targetMarginBp !== null ? `Margin, target ${formatMarginBp(job.targetMarginBp)}` : 'Margin'} value={formatMarginBp(job.marginBp, { empty: 'None yet' })} tone={job.marginBp !== null && job.marginBp < 0 ? 'danger' : undefined} />
          </dl>
          <PlanBar label="Labor" planCents={job.planLaborCents} actualCents={job.laborCents} />
          <PlanBar label="Materials" planCents={job.planMaterialCents} actualCents={job.materialCents} />
          {open && job.projectedProfitCents !== null ? (
            <p className="text-xs text-secondary">
              At this pace the job finishes with a profit of{' '}
              <span className={cn('font-semibold tabular-nums', job.projectedProfitCents < 0 ? 'text-danger' : 'text-foreground')}>{formatCents(job.projectedProfitCents)}</span>.
            </p>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {data.canLog && open ? (
          <PulseLink href={job.logUrl} variant="primary" testId="pulse-log-production">
            <ClipboardPen aria-hidden className="size-3.5" />
            Log production
          </PulseLink>
        ) : null}
        <PulseLink href={job.url} testId="pulse-open-job">
          <ArrowUpRight aria-hidden className="size-3.5" />
          Open in Pulse
        </PulseLink>
      </div>
    </div>
  );
}

export function JobProfitCard({ workOrderId, workOrderCode }: { readonly workOrderId: string; readonly workOrderCode: string }) {
  const query = useApiQuery<WorkOrderPulseDto>(['work-order-pulse', workOrderId], `/api/work-orders/${encodeURIComponent(workOrderId)}/pulse`, {
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const data = query.data?.data;
  // Hidden while unknown and on any failure: a sibling app must never add noise to this page.
  if (query.isError || (data && !data.available)) return null;
  const title = (
    <header className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <PulseMark size={16} />
        Job profit
      </h2>
      {data?.jobs.length ? <span className="text-2xs text-faint">From KitStak Pulse</span> : null}
    </header>
  );
  if (!data) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4 shadow-xs" aria-busy="true" aria-label="Loading job profit from KitStak Pulse" data-testid="job-profit-card-loading">
        {title}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-xs" aria-label="Job profit from KitStak Pulse" data-testid="job-profit-card">
      {title}
      {data.jobs.length === 0 ? (
        <div className="flex flex-col gap-3" data-testid="pulse-no-job">
          <p className="text-xs text-secondary">
            Pulse is not tracking profit for {workOrderCode} yet.{' '}
            {data.createJobUrl
              ? 'Create a Pulse job from this work order and Pulse fills in the client, the kit and the quantity. Then log people and hours each day to see what the job earns.'
              : 'Your Pulse role cannot add jobs. Ask a manager to create one from this work order.'}
          </p>
          <div>
            {data.createJobUrl ? (
              <PulseLink href={data.createJobUrl} variant="primary" testId="pulse-create-job">
                <Plus aria-hidden className="size-3.5" />
                Create Pulse job from this work order
              </PulseLink>
            ) : (
              <PulseLink href={data.pulseUrl}>
                <ArrowUpRight aria-hidden className="size-3.5" />
                Open KitStak Pulse
              </PulseLink>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {data.jobs.map((job, index) => (
            <React.Fragment key={job.id}>
              {index > 0 ? <hr className="border-border" /> : null}
              <JobBlock job={job} data={data} />
            </React.Fragment>
          ))}
          {data.moneyHidden ? null : (
            <details className="text-xs text-secondary">
              <summary className="cursor-pointer font-medium text-body">How we got these numbers</summary>
              <p className="mt-1.5">
                Revenue is the units logged in Pulse at the job&apos;s price. Cost is labor (hours times your real cost of an hour), materials, other costs and a share of time not on a job. Profit
                is revenue minus cost. Margin is profit as a share of revenue. Open the job in Pulse to see every entry.
              </p>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
