'use client';
/**
 * "Job profit" strip for the project Overview: the KitStak Pulse jobs linked to this project,
 * each with its health, how far along it is, revenue, cost, profit and margin, plus the totals.
 * With nothing linked yet, people who may add Pulse jobs get "Track profit for this project".
 *
 * Read from the shared database by this app's own server (through @kitstak/pulse-bridge) and
 * refetched when the window regains focus. Nothing is worked out here. Hidden when Pulse is not
 * licensed, not installed, or this person has no Pulse role. People who may not see money in
 * Pulse get units, hours and health only.
 */
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ClipboardPen, EyeOff, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatCents, formatMarginBp, formatQuantity, statusTone, type PulseTone } from '@kitstak/pulse-bridge/format';
import { ProgressBar, Skeleton, cn } from '@/components/ui';
import { buttonVariants } from '@/components/ui/button';
import { apiGet, apiPath } from '@/lib/api-client';
import type { PulseProfit, PulseProfitJob } from '@/server/integrations/pulse-profit';

export const pulseProfitKey = (projectKey: string) => ['project', projectKey, 'pulse-profit'] as const;

export function usePulseProfit(projectKey: string) {
  return useQuery({
    queryKey: pulseProfitKey(projectKey),
    queryFn: () => apiGet<PulseProfit>(apiPath(`projects/${encodeURIComponent(projectKey)}/pulse-profit`)),
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: 120_000,
    retry: false,
  });
}

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** Rect for rect from the official brand file `kitstak-icon-pulse.svg`. */
function PulseMark({ size = 16 }: { readonly size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="32 44 136 112" className="shrink-0">
      <rect x="40" y="62" width="120" height="30" fill="#C8102E" />
      <rect x="40" y="108" width="120" height="30" fill="#D65A6E" opacity="0.35" />
      <rect x="40" y="108" width="84" height="30" fill="#D65A6E" />
    </svg>
  );
}

const PILL: Readonly<Record<PulseTone, string>> = {
  good: 'bg-success-subtle text-success-text',
  watch: 'bg-warning-subtle text-warning-text',
  warn: 'bg-warning-subtle text-warning-text',
  bad: 'bg-danger-subtle text-danger-text',
  quiet: 'bg-sunken text-fg-secondary',
};

function StatusPill({ job }: { readonly job: PulseProfitJob }) {
  return (
    <span className={cn('inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-xs font-medium', PILL[statusTone(job.risk)])}>{job.riskLabel ?? job.statusLabel}</span>
  );
}

function LinkButton({ href, children, variant = 'secondary', testId }: { readonly href: string; readonly children: ReactNode; readonly variant?: 'primary' | 'secondary' | 'ghost'; readonly testId?: string }) {
  return (
    <a href={href} {...external} className={buttonVariants({ variant, size: 'sm' })} data-testid={testId}>
      {children}
      <span className="sr-only"> (opens KitStak Pulse in a new tab)</span>
    </a>
  );
}

function Metric({ label, value, tone }: { readonly label: string; readonly value: string; readonly tone?: 'danger' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-2">
      <dt className="truncate text-xs font-medium text-fg-muted">{label}</dt>
      <dd className={cn('truncate text-lg leading-tight font-semibold tabular-nums', tone === 'danger' ? 'text-danger-text' : 'text-fg')}>{value}</dd>
    </div>
  );
}

function JobRow({ job, data }: { readonly job: PulseProfitJob; readonly data: PulseProfit }) {
  const done = job.pctCompleteBp === null ? null : Math.round(job.pctCompleteBp / 100);
  const tone = statusTone(job.risk);
  const open = job.status !== 'completed' && job.status !== 'cancelled';
  return (
    <li className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:gap-4" data-testid="pulse-profit-job">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-2xs font-semibold tracking-[0.04em] text-fg-secondary tabular-nums">{job.number}</span>
          <a href={job.url} {...external} className="min-w-0 truncate text-sm font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus">
            {job.name}
          </a>
          <StatusPill job={job} />
        </div>
        <ProgressBar value={done ?? 0} size="sm" tone={tone === 'bad' ? 'danger' : tone === 'warn' ? 'warning' : 'primary'} label={`${job.number} is ${done ?? 0} percent done`} />
        <p className="text-xs text-fg-muted tabular-nums">
          {formatQuantity(job.unitsGood)} of {formatQuantity(job.plannedUnits)} {job.unitLabel} done
          {done !== null ? ` (${done}%)` : ''} · {formatQuantity(job.hours)} hours logged in Pulse
        </p>
      </div>
      {data.moneyHidden ? null : (
        <dl className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4 lg:w-[420px]">
          {(
            [
              ['Revenue', formatCents(job.revenueCents), false],
              ['Cost', formatCents(job.costCents), false],
              ['Profit', formatCents(job.profitCents), (job.profitCents ?? 0) < 0],
              ['Margin', formatMarginBp(job.marginBp, { empty: 'None yet' }), job.marginBp !== null && job.marginBp < 0],
            ] as const
          ).map(([label, value, bad]) => (
            <div key={label} className="flex min-w-0 flex-col">
              <dt className="text-fg-muted">{label}</dt>
              <dd className={cn('truncate text-sm font-semibold tabular-nums', bad ? 'text-danger-text' : 'text-fg')}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        {data.canLog && open ? (
          <LinkButton href={job.logUrl} variant="ghost" testId="pulse-profit-log">
            <ClipboardPen aria-hidden />
            Log work
          </LinkButton>
        ) : null}
        <LinkButton href={job.url} testId="pulse-profit-open">
          <ArrowUpRight aria-hidden />
          Open
        </LinkButton>
      </div>
    </li>
  );
}

export function PulseProfitStrip({ projectKey, canEdit = false }: { readonly projectKey: string; readonly canEdit?: boolean }) {
  const query = usePulseProfit(projectKey);
  if (query.isPending) {
    return (
      <section aria-busy="true" aria-label="Loading job profit from KitStak Pulse" className="rounded-xl border border-border-subtle bg-panel p-4 shadow-xs lg:col-span-2">
        <Skeleton width={140} height={14} />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} height={44} rounded="md" />
          ))}
        </div>
      </section>
    );
  }
  const data = query.data;
  // A sibling app never adds noise: hidden on any failure and when Pulse is not available.
  if (!data || !data.available) return null;
  // Nothing linked and no right to add a job: nothing useful to show.
  if (data.jobs.length === 0 && !(canEdit && data.createJobUrl)) return null;
  const totals = data.totals;
  return (
    <section aria-labelledby="pulse-profit-title" className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs lg:col-span-2" data-testid="pulse-profit">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-3">
        <h2 id="pulse-profit-title" className="flex min-w-0 items-center gap-2 text-md font-semibold text-fg">
          <PulseMark />
          Job profit
        </h2>
        <span className="text-xs text-fg-muted">From KitStak Pulse, for the jobs linked to this project</span>
        {data.createJobUrl && data.jobs.length > 0 ? (
          <span className="ml-auto">
            <LinkButton href={data.createJobUrl} variant="ghost" testId="pulse-profit-add">
              <Plus aria-hidden />
              Another job
            </LinkButton>
          </span>
        ) : null}
      </header>
      {data.jobs.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4" data-testid="pulse-profit-empty">
          <p className="min-w-0 flex-1 basis-72 text-sm text-fg-secondary">
            Pulse is not tracking profit for this project yet. Link a Pulse job and you see what the work earns after labor and materials, right here. Time logged on this project can count as
            the job&apos;s labor hours.
          </p>
          <LinkButton href={data.createJobUrl as string} variant="primary" testId="pulse-profit-create">
            <Plus aria-hidden />
            Track profit for this project
          </LinkButton>
        </div>
      ) : (
        <>
          {data.moneyHidden ? (
            <p className="flex items-center gap-2 border-b border-border-subtle bg-sunken px-4 py-2 text-xs text-fg-secondary" data-testid="pulse-profit-money-hidden">
              <EyeOff aria-hidden className="size-3.5 shrink-0" />
              Your Pulse role does not include money, so revenue, cost and profit are hidden here.
            </p>
          ) : totals ? (
            <dl className="grid grid-cols-2 gap-1 border-b border-border-subtle px-1.5 py-1.5 sm:grid-cols-4" data-testid="pulse-profit-totals">
              <Metric label={totals.jobs === 1 ? 'Revenue so far' : `Revenue, ${totals.jobs} jobs`} value={formatCents(totals.revenueCents)} />
              <Metric label="Cost so far" value={formatCents(totals.costCents)} />
              <Metric label="Profit so far" value={formatCents(totals.profitCents)} tone={(totals.profitCents ?? 0) < 0 ? 'danger' : undefined} />
              <Metric label="Margin" value={formatMarginBp(totals.marginBp, { empty: 'None yet' })} tone={totals.marginBp !== null && totals.marginBp < 0 ? 'danger' : undefined} />
            </dl>
          ) : null}
          <ul className="divide-y divide-border-subtle">
            {data.jobs.map((job) => (
              <JobRow key={job.id} job={job} data={data} />
            ))}
          </ul>
          {data.moneyHidden ? null : (
            <details className="border-t border-border-subtle px-4 py-2 text-xs text-fg-secondary">
              <summary className="cursor-pointer font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">How we got these numbers</summary>
              <p className="mt-1.5 max-w-3xl">
                Revenue is the units and services logged in Pulse at each job&apos;s price. Cost is labor (hours times your real cost of an hour), materials, other costs and a share of time not on a
                job. Profit is revenue minus cost. Margin is profit as a share of revenue. Open a job in Pulse to see every entry behind it.
              </p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
