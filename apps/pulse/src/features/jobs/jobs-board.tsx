'use client';
/**
 * The jobs board: one column per status, worst on the left. Pulse puts each job in its column
 * from its numbers, so the cards cannot be dragged: fix the cause and the card moves itself.
 */
import Link from 'next/link';
import { MarginPill } from '@/components/charts/stats';
import { cn } from '@/components/ui/cn';
import { PULSE_STATUS_LABELS, type PulseStatus } from '@/lib/constants';
import { formatMoney, formatPercentBp } from '@/lib/format';
import { centsToNumber, sumCents } from '@/lib/money';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { JobListItemDTO } from '@/lib/types';
import { singularUnit } from './job-math';
import { UnitsProgress } from './job-ui';

const COLUMNS: readonly (PulseStatus | 'none')[] = ['losing', 'at_risk', 'no_data', 'heads_up', 'on_track', 'none'];

const HINT: Readonly<Record<PulseStatus | 'none', string>> = {
  losing: 'Costs more than it earns.',
  at_risk: 'Heading under your margin floor or target.',
  no_data: 'Something is missing, so the numbers cannot be trusted yet.',
  heads_up: 'Worth a look, not urgent.',
  on_track: 'At or above target.',
  none: 'Planned, on hold or cancelled.',
};

export function JobsBoard({ jobs, seesMoney }: { readonly jobs: readonly JobListItemDTO[]; readonly seesMoney: boolean }) {
  const columns = COLUMNS.map((status) => ({ status, jobs: jobs.filter((job) => (job.stats.riskStatus ?? 'none') === status) })).filter((column) => column.status !== 'none' || column.jobs.length > 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-fg-muted">Pulse sorts jobs into these columns from their numbers. Fix the cause and the card moves on its own.</p>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" data-testid="jobs-board" role="list" aria-label="Jobs by status">
        {columns.map((column) => {
          const total = centsToNumber(sumCents(column.jobs.map((job) => job.stats.projectedProfitCents)));
          return (
            <section key={column.status} role="listitem" aria-label={column.status === 'none' ? 'No status yet' : PULSE_STATUS_LABELS[column.status]} className="flex w-[280px] shrink-0 snap-start flex-col rounded-xl border border-border-subtle bg-sunken" data-testid={`board-col-${column.status}`}>
              <header className="flex flex-col gap-1 border-b border-border-subtle px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  {column.status === 'none' ? <span className="text-sm font-semibold text-fg">No status yet</span> : <MarginPill status={column.status} />}
                  <span className="text-sm font-semibold text-fg tabular-nums">{column.jobs.length}</span>
                </div>
                <p className="text-2xs text-fg-muted">{HINT[column.status]}</p>
                {seesMoney && column.jobs.some((job) => job.stats.projectedProfitCents !== null) ? (
                  <p className={cn('text-xs tabular-nums', total < 0 ? 'text-danger-text' : 'text-fg-secondary')}>Profit at finish {formatMoney(total, { cents: false })}</p>
                ) : null}
              </header>
              <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                {column.jobs.length === 0 ? <li className="px-2 py-6 text-center text-xs text-fg-muted">No jobs here.</li> : null}
                {column.jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={routes.job(job.number)}
                      data-testid={`board-card-${job.number}`}
                      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3 shadow-xs transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{job.name}</p>
                        <p className="truncate text-xs text-fg-muted">
                          {job.number} · {job.clientName}
                        </p>
                      </div>
                      {job.stats.headline ? <p className="line-clamp-3 text-xs text-fg-secondary">{job.stats.headline}</p> : null}
                      <UnitsProgress done={job.stats.unitsGood} planned={job.plannedUnits} pctBp={job.stats.pctCompleteBp} unit={singularUnit(job.unitLabel)} />
                      <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
                        {seesMoney && !job.stats.moneyHidden ? (
                          <span>
                            Margin <span className="font-medium text-fg tabular-nums">{formatPercentBp(job.stats.marginBp, { empty: 'none yet' })}</span>
                            {job.stats.projectedProfitCents !== null ? (
                              <>
                                {' · '}
                                <span className={cn('font-medium tabular-nums', job.stats.projectedProfitCents < 0 ? 'text-danger-text' : 'text-fg')}>{formatMoney(job.stats.projectedProfitCents, { cents: false })}</span>
                              </>
                            ) : null}
                          </span>
                        ) : (
                          <span />
                        )}
                        {job.dueDate ? <span className="whitespace-nowrap">Due {shortDate(job.dueDate)}</span> : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
