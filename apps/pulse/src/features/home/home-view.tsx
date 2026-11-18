'use client';
/**
 * Home: the two line answer, the headline numbers for a chosen period against the period before,
 * the jobs that need you, the trend, the best and worst clients and job types, today's entries
 * and open alerts. People who may not see money get pace, units and hours instead: the server
 * sends their money fields blank, and this view swaps the money tiles for floor tiles.
 */
import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { ArrowRight, BellRing, CircleCheck, ClipboardPen, PackagePlus, Rocket, Wrench } from 'lucide-react';
import { BarChart, ComboChart } from '@/components/charts/cartesian';
import { DonutChart, ProgressRing } from '@/components/charts/radial';
import { KpiTile, MarginPill } from '@/components/charts/stats';
import { ButtonLink } from '@/components/pulse/button-link';
import { ExplainNumber } from '@/components/pulse/explain';
import { ExplainStatic } from '@/components/pulse/explain';
import { StepList, Teach } from '@/components/pulse/teach';
import { ProgressBar } from '@/components/ui/feedback';
import { cn } from '@/components/ui/cn';
import { formatHours, formatMoney, formatMoneyWhole, formatNumber, formatPace, formatPercentBp, formatPercentWhole } from '@/lib/format';
import { useAlerts, useJobsNeedingAttention, useProfit, useSummary } from '@/lib/hooks/use-data';
import { CONFIDENCE_LABELS } from '@/lib/profit/types';
import { suggestBucket } from '@/lib/profit/trends';
import { compareRange, rangeLabel, type RangePreset } from '@/lib/reports';
import { routes } from '@/lib/routes';
import type { ProfitResponse, ProfitRowDTO, SummaryDTO } from '@/lib/types';
import { parsePeriod, periodQuery } from '@/features/profit/period';
import { PeriodPicker, type PeriodChange } from '@/features/profit/period-picker';
import { rowLabel } from '@/features/profit/profit-model';
import { LoadError, Section, comparable, moneyDelta, numberDelta, pointsDelta } from '@/features/profit/profit-ui';
import { useQueryState } from '@/features/profit/use-query-state';
import { useShell } from '@/features/shell/shell-context';

const PERIOD_WORDS: Readonly<Record<RangePreset, string>> = {
  this_week: 'this week',
  last_week: 'last week',
  this_month: 'this month',
  last_month: 'last month',
  last_30: 'in the last 30 days',
  last_90: 'in the last 90 days',
  this_quarter: 'this quarter',
  this_year: 'this year',
  custom: 'in this period',
};

const num = (value: string | null | undefined): number | null => (value === null || value === undefined || value === '' ? null : Number(value));

function SeeAll({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus print:hidden">
      {children}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

function ranking(rows: readonly ProfitRowDTO[], pick: (row: ProfitRowDTO) => number | null, limit = 6): ProfitRowDTO[] {
  const usable = rows.filter((row) => pick(row) !== null && row.key !== 'none');
  const sorted = [...usable].sort((a, b) => (pick(b) as number) - (pick(a) as number));
  if (sorted.length <= limit) return sorted;
  // The best and the worst: the middle is on the Profit page.
  return [...sorted.slice(0, limit / 2), ...sorted.slice(-limit / 2)];
}

export interface HomeViewProps {
  readonly today: string;
  readonly weekStart: number;
  readonly targetMarginBp: number;
  readonly initialSummary?: SummaryDTO;
  readonly initialTrend?: ProfitResponse;
  /** The period the server read, so its data is only used for that period. */
  readonly initialRange: { readonly from: string; readonly to: string };
}

export function HomeView({ today, weekStart, targetMarginBp, initialSummary, initialTrend, initialRange }: HomeViewProps) {
  const { seesMoney, can } = useShell();
  const { get, set } = useQueryState();
  const period = useMemo(() => parsePeriod(get, today, weekStart), [get, today, weekStart]);
  const prior = useMemo(() => compareRange('prior', period) as { from: string; to: string }, [period]);
  const bucket = suggestBucket(period);
  const fromServer = period.from === initialRange.from && period.to === initialRange.to;
  const scope = { from: period.from, to: period.to };

  const summary = useSummary(scope, { initialData: fromServer ? initialSummary : undefined });
  const trend = useProfit(bucket, scope, { initialData: fromServer ? initialTrend : undefined });
  const before = useProfit('month', prior);
  const byClient = useProfit('client', scope);
  const byType = useProfit('type', scope);
  const attention = useJobsNeedingAttention(6);
  const alerts = useAlerts({ status: 'open', limit: 4 });

  const setPeriod = useCallback(
    (change: PeriodChange) => set(periodQuery({ preset: change.preset ?? period.preset, from: change.from ?? period.from, to: change.to ?? period.to, compare: 'none' })),
    [period, set],
  );

  const total = trend.data?.total ?? summary.data?.total ?? null;
  const previous = comparable(before.data);
  const points = useMemo(() => [...(trend.data?.rows ?? [])].sort((a, b) => a.key.localeCompare(b.key)), [trend.data]);
  const dates = points.map((row) => row.key);
  const spark = (pick: (row: ProfitRowDTO) => number | null) => (points.length > 1 ? { values: points.map(pick) } : undefined);
  const data = summary.data;
  const needYou = data ? data.losing + data.atRisk : 0;
  const words = period.preset === 'custom' ? `from ${rangeLabel(period)}` : PERIOD_WORDS[period.preset];
  const vs = 'vs before';
  const firstRun = data !== undefined && data.openJobs === 0 && total !== null && Number(total.unitsGood) === 0 && (total.revenueCents ?? 0) === 0 && period.preset === 'this_month';

  if (summary.isError && !data) return <LoadError what="your numbers" message={summary.error instanceof Error ? summary.error.message : undefined} onRetry={() => void summary.refetch()} />;

  if (firstRun) {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" data-testid="home-first-run">
        <section className="rounded-xl border border-border-subtle bg-panel shadow-xs">
          <Teach
            icon={Rocket}
            title="No profit numbers yet"
            why="Pulse turns your jobs, daily work and costs into one answer: are we making money, and if not, why? Add a job and log one day to see it here."
            points={['Profit on your jobs, and profit for the whole company', 'Jobs that need you, worst first, with the reason', 'Today’s entries, alerts and things to fix']}
            actions={
              <>
                {can('job:manage') ? (
                  <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />}>
                    Add your first job
                  </ButtonLink>
                ) : null}
                <ButtonLink href={routes.welcome()} variant="secondary" icon={<Rocket aria-hidden />}>
                  Other ways to start
                </ButtonLink>
              </>
            }
          />
        </section>
        <Section title="Five steps to your first profit number">
          <StepList
            steps={[
              { title: 'Set a labor rate', detail: 'Tell Pulse what an hour of work really costs you.', action: <ButtonLink href={routes.labor('rates')} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'Add a client', detail: 'The company you do the work for.', action: <ButtonLink href={routes.profit({ by: 'client' })} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'Add a job', detail: 'One piece of work with a price and a number of units.', action: <ButtonLink href={routes.newJob()} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'Log a day', detail: 'Units finished, people and hours.', action: <ButtonLink href={routes.log()} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'See your profit', detail: 'Revenue, cost and margin for the job, right away.', action: <ButtonLink href={routes.profit()} variant="secondary" size="sm">Open</ButtonLink> },
            ]}
          />
        </Section>
      </div>
    );
  }

  const bridge = data?.bridge ?? null;
  const progress = data?.entryProgress ?? null;
  const fix = data?.thingsToFix ?? null;
  const fixes = fix
    ? [
        { count: fix.unitsNoHours, one: 'day has units and no hours', many: 'days have units and no hours', href: routes.logEntries(), action: 'Add the hours' },
        { count: fix.needsRate, one: 'entry has no labor rate', many: 'entries have no labor rate', href: routes.labor('rates'), action: 'Set a rate' },
        { count: fix.noPrice, one: 'job has no price', many: 'jobs have no price', href: routes.jobs({ tab: 'open' }), action: 'Open jobs' },
        { count: fix.serviceNoPrice, one: 'extra service entry has no price', many: 'extra service entries have no price', href: routes.services(), action: 'Open services' },
      ].filter((item) => item.count > 0 && (seesMoney || item.one.includes('hours')))
    : [];
  const loadingTiles = !total;
  const clientRows = ranking(byClient.data?.rows ?? [], (row) => (seesMoney ? row.profitCents : num(row.unitsGood)));
  const typeRows = ranking(byType.data?.rows ?? [], (row) => (seesMoney ? row.profitCents : num(row.unitsGood)));
  const cost = total && seesMoney ? [{ id: 'labor', label: 'Labor', value: total.laborCents ?? 0 }, { id: 'material', label: 'Material', value: total.materialCents ?? 0 }, { id: 'other', label: 'Other costs', value: total.otherCents ?? 0 }, { id: 'shared', label: 'Time not on a job', value: total.sharedCents ?? 0 }].filter((slice) => slice.value > 0) : [];

  return (
    <div className="flex flex-col gap-4" data-testid="home-view">
      {/* The answer, in two lines */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs sm:p-5" data-testid="home-answer">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[420px] text-lg leading-snug text-fg-secondary">
            {!total || !data ? (
              <span role="status" aria-busy="true" className="flex flex-col gap-2">
                <span className="sr-only">Loading your numbers</span>
                <span aria-hidden className="ks-skeleton block h-5 w-4/5 rounded-full" />
                <span aria-hidden className="ks-skeleton block h-5 w-3/5 rounded-full" />
              </span>
            ) : seesMoney ? (
              <>
                <p>
                  Your jobs made <strong className={cn('font-semibold tabular-nums', (total.profitCents ?? 0) < 0 ? 'text-danger-text' : 'text-fg')}>{formatMoneyWhole(total.profitCents)}</strong> {words}
                  {total.marginBp !== null ? (
                    <>
                      {' '}
                      at a <strong className="font-semibold text-fg tabular-nums">{formatPercentWhole(total.marginBp)}</strong> margin
                    </>
                  ) : null}
                  .
                </p>
                {bridge && bridge.companyProfitCents !== null ? (
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5">
                    <span>
                      After time not on a job and overhead, the company made <strong className={cn('font-semibold tabular-nums', bridge.companyProfitCents < 0 ? 'text-danger-text' : 'text-fg')}>{formatMoneyWhole(bridge.companyProfitCents)}</strong>.
                    </span>
                    <ExplainNumber metric="company_profit" scope={scope} label="How we got company profit" align="start" />
                  </p>
                ) : null}
              </>
            ) : (
              <p>
                Your crews finished <strong className="font-semibold text-fg tabular-nums">{formatNumber(total.unitsGood, { maxDigits: 0 })}</strong> units {words} in <strong className="font-semibold text-fg tabular-nums">{formatHours(total.hours, { maxDigits: 0 })}</strong> labor hours
                {total.uph !== null ? (
                  <>
                    , at <strong className="font-semibold text-fg tabular-nums">{formatPace(total.uph)}</strong> units per person per hour
                  </>
                ) : null}
                .
              </p>
            )}
            {data ? (
              <p className="mt-1">
                {needYou > 0 ? (
                  <Link href={routes.jobs({ tab: 'open', risk: 'losing,at_risk' })} className="rounded-sm font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="home-need-you">
                    {needYou} {needYou === 1 ? 'job needs' : 'jobs need'} you.
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-base">
                    <CircleCheck aria-hidden className="size-4 text-success" />
                    No job needs you right now.
                  </span>
                )}
              </p>
            ) : null}
          </div>
          <PeriodPicker period={period} onChange={setPeriod} showCompare={false} className="print:hidden" />
        </div>
      </section>

      {/* Headline numbers against the period before */}
      {seesMoney ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 min-[1680px]:grid-cols-6" data-testid="home-tiles">
          <KpiTile label="Revenue" loading={loadingTiles} value={total ? formatMoneyWhole(total.revenueCents) : null} delta={total ? moneyDelta(total.revenueCents, previous?.revenueCents, 'up', vs) : undefined} sparkline={spark((row) => row.revenueCents)} explain={<ExplainNumber metric="revenue" scope={scope} />} />
          <KpiTile label="Cost" loading={loadingTiles} value={total ? formatMoneyWhole(total.costCents) : null} delta={total ? moneyDelta(total.costCents, previous?.costCents, 'down', vs) : undefined} sparkline={spark((row) => row.costCents)} explain={<ExplainNumber metric="cost" scope={scope} />} />
          <KpiTile label="Profit on jobs" loading={loadingTiles} value={total ? formatMoneyWhole(total.profitCents) : null} delta={total ? moneyDelta(total.profitCents, previous?.profitCents, 'up', vs) : undefined} sparkline={spark((row) => row.profitCents)} explain={<ExplainNumber metric="profit" scope={scope} />} />
          <KpiTile label="Margin after all costs" loading={loadingTiles} value={total ? formatPercentBp(total.marginBp, { empty: 'No revenue yet' }) : null} delta={total ? pointsDelta(total.marginBp, previous?.marginBp, 'up', vs) : undefined} sparkline={spark((row) => row.marginBp)} explain={<ExplainNumber metric="margin" scope={scope} />} />
          <KpiTile label="Labor as % of revenue" loading={loadingTiles} value={total ? formatPercentBp(total.laborPctBp, { empty: 'No revenue yet' }) : null} delta={total ? pointsDelta(total.laborPctBp, previous?.laborPctBp, 'down', vs) : undefined} sparkline={spark((row) => row.laborPctBp)} explain={<ExplainNumber metric="labor_pct" scope={scope} />} />
          <KpiTile label="Units per person per hour" loading={loadingTiles} value={total ? formatPace(total.uph, { empty: 'No hours yet' }) : null} delta={total ? numberDelta(num(total.uph), previous ? num(previous.uph) : undefined, 'up', vs, 1) : undefined} sparkline={spark((row) => num(row.uph))} explain={<ExplainNumber metric="uph" scope={scope} />} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="home-tiles-floor">
          <KpiTile label="Units finished" loading={loadingTiles} value={total ? formatNumber(total.unitsGood, { maxDigits: 0 }) : null} delta={total ? numberDelta(num(total.unitsGood), previous ? num(previous.unitsGood) : undefined, 'up', vs) : undefined} sparkline={spark((row) => num(row.unitsGood))} explain={<ExplainNumber metric="units" scope={scope} />} />
          <KpiTile label="Labor hours" loading={loadingTiles} value={total ? formatHours(total.hours, { maxDigits: 0 }) : null} sparkline={spark((row) => num(row.hours))} explain={<ExplainNumber metric="hours" scope={scope} />} />
          <KpiTile label="Units per person per hour" loading={loadingTiles} value={total ? formatPace(total.uph, { empty: 'No hours yet' }) : null} delta={total ? numberDelta(num(total.uph), previous ? num(previous.uph) : undefined, 'up', vs, 1) : undefined} sparkline={spark((row) => num(row.uph))} explain={<ExplainNumber metric="uph" scope={scope} />} />
          <KpiTile label="Share of paid time spent on jobs" explain={<ExplainStatic title="Share of paid time spent on jobs" rule="Hours on jobs divided by paid hours. When no paid hours are typed for these days, it is hours on jobs divided by hours on jobs plus time not on a job." rows={bridge ? [{ label: 'Hours on jobs', value: formatHours(bridge.directHours) }, { label: 'Time not on a job', value: formatHours(bridge.indirectHours) }, { label: 'Paid hours', value: formatHours(bridge.paidHours) }, { label: 'Share on jobs', value: formatPercentBp(bridge.utilizationBp, { empty: 'No hours yet' }), kind: 'total' }] : []} />} loading={!data} value={data ? formatPercentBp(bridge?.utilizationBp ?? null, { empty: 'No hours yet' }) : null} footer={bridge ? <span className="text-xs text-fg-muted">{formatHours(bridge.indirectHours, { maxDigits: 0 })} hours not on a job</span> : undefined} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* Jobs that need you */}
        <Section title="Jobs that need you" hint="Worst first, with the reason." action={<SeeAll href={routes.jobs({ tab: 'open' })}>All open jobs</SeeAll>} bodyClassName="p-0" testId="home-attention">
          {attention.isError ? (
            <div className="p-4">
              <LoadError what="the jobs that need you" onRetry={() => void attention.refetch()} compact />
            </div>
          ) : !attention.data ? (
            <div role="status" aria-busy="true" className="flex flex-col gap-2 p-4">
              <span className="sr-only">Loading the jobs that need you</span>
              {[0, 1, 2].map((index) => (
                <span key={index} aria-hidden className="ks-skeleton block h-12 rounded-md" />
              ))}
            </div>
          ) : attention.data.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="home-attention-empty">
              <CircleCheck aria-hidden className="size-8 text-success" />
              <p className="text-md font-semibold text-fg">Every open job is on track</p>
              <p className="max-w-md text-sm text-fg-secondary">Jobs show up here when they are losing money, heading under your target margin or missing data. Nothing is flagged right now.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {attention.data.map((job) => (
                <li key={job.id}>
                  <Link href={routes.job(job.number)} data-testid="home-attention-row" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus">
                    <div className="min-w-0 flex-1 basis-[260px]">
                      <p className="flex items-center gap-2 text-sm font-medium text-fg">
                        <span className="tabular-nums">{job.number}</span>
                        <span className="truncate font-normal text-fg-secondary">{job.name}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-fg-secondary">{job.stats.headline || 'Open the job to see what is missing.'}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">{job.clientName}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {seesMoney && job.stats.projectedProfitCents !== null ? (
                        <div className="text-right">
                          <p className={cn('text-sm font-semibold tabular-nums', job.stats.projectedProfitCents < 0 ? 'text-danger-text' : 'text-fg')}>{formatMoney(job.stats.projectedProfitCents, { cents: false })}</p>
                          <p className="text-xs text-fg-muted">{job.stats.mode === 'actuals' ? 'profit, last 30 days' : job.stats.mode === 'final' ? 'final profit' : 'projected profit'}{job.stats.confidence ? `, ${CONFIDENCE_LABELS[job.stats.confidence].toLowerCase()}` : ''}</p>
                        </div>
                      ) : null}
                      {job.stats.riskStatus ? <MarginPill status={job.stats.riskStatus} /> : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="flex min-w-0 flex-col gap-4">
          {/* Today's entries */}
          <Section title="Today’s entries" action={can('production:log') ? <SeeAll href={routes.log()}>Log work</SeeAll> : undefined} testId="home-entries">
            {!progress ? (
              <span role="status" aria-busy="true" className="ks-skeleton block h-16 rounded-md">
                <span className="sr-only">Loading today’s entries</span>
              </span>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <ProgressRing value={progress.loggedToday} max={Math.max(progress.activeJobs, 1)} label="Active jobs logged today" size={64} tone={progress.activeJobs > 0 && progress.loggedToday >= progress.activeJobs ? 'good' : 'accent'}>
                    <span className="text-sm font-semibold tabular-nums">
                      {progress.loggedToday}/{progress.activeJobs}
                    </span>
                  </ProgressRing>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg" data-testid="home-logged">
                      {progress.activeJobs === 0 ? 'No active jobs today' : `${progress.loggedToday} of ${progress.activeJobs} active ${progress.activeJobs === 1 ? 'job' : 'jobs'} logged today`}
                    </p>
                    <p className="mt-0.5 text-sm text-fg-secondary">
                      {progress.activeJobs === 0 ? 'Start a job and it shows up on the log.' : progress.loggedToday >= progress.activeJobs ? 'Every active job has an entry for today.' : `${progress.activeJobs - progress.loggedToday} still ${progress.activeJobs - progress.loggedToday === 1 ? 'needs' : 'need'} units and hours. Jobs that did not run today can stay blank.`}
                    </p>
                  </div>
                </div>
                {progress.workDaysThisWeek > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm text-fg-secondary" data-testid="home-reviewed">
                      {progress.daysReviewedThisWeek} of {progress.workDaysThisWeek} work {progress.workDaysThisWeek === 1 ? 'day' : 'days'} reviewed this week
                    </p>
                    <ProgressBar value={Math.min(100, Math.round((progress.daysReviewedThisWeek / progress.workDaysThisWeek) * 100))} label={`${progress.daysReviewedThisWeek} of ${progress.workDaysThisWeek} work ${progress.workDaysThisWeek === 1 ? 'day' : 'days'} reviewed this week`} tone={progress.daysReviewedThisWeek >= progress.workDaysThisWeek ? 'success' : 'primary'} size="sm" />
                  </div>
                ) : <p className="text-sm text-fg-secondary">The week just started. Days to review show up here from tomorrow.</p>}
              </div>
            )}
          </Section>

          {/* Open alerts */}
          <Section title={`Alerts${data && data.openAlerts > 0 ? `, ${data.openAlerts} open` : ''}`} action={<SeeAll href={routes.alerts()}>All alerts</SeeAll>} bodyClassName="p-0" testId="home-alerts">
            {alerts.isError ? (
              <div className="p-4">
                <LoadError what="your alerts" onRetry={() => void alerts.refetch()} compact />
              </div>
            ) : !alerts.data ? (
              <div role="status" aria-busy="true" className="p-4">
                <span className="sr-only">Loading alerts</span>
                <span aria-hidden className="ks-skeleton block h-14 rounded-md" />
              </div>
            ) : alerts.data.length === 0 ? (
              <div className="flex items-start gap-3 p-4" data-testid="home-alerts-empty">
                <BellRing aria-hidden className="mt-0.5 size-5 shrink-0 text-icon" />
                <p className="text-sm text-fg-secondary">
                  No open alerts. Pulse tells you here when a job heads under your target margin, a day has no hours, or work sits unbilled.{' '}
                  <Link href={routes.alertRules()} className="rounded-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                    See the rules
                  </Link>
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {alerts.data.map((alert) => (
                  <li key={alert.id}>
                    <Link href={alert.url ?? routes.alerts()} className="flex items-start gap-3 px-4 py-2.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus">
                      <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', alert.severity === 'critical' ? 'bg-danger' : alert.severity === 'warning' ? 'bg-[var(--warning-accent)]' : 'bg-info')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">
                          <span className="sr-only">{alert.severity === 'critical' ? 'Urgent: ' : alert.severity === 'warning' ? 'Warning: ' : ''}</span>
                          {alert.title}
                        </span>
                        <span className="block truncate text-sm text-fg-secondary">{alert.body}</span>
                      </span>
                      {seesMoney && alert.impactCents !== null && alert.impactCents !== 0 ? <span className="shrink-0 text-sm text-danger-text tabular-nums">{formatMoney(alert.impactCents, { cents: false })}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* Trend */}
        <Section title={seesMoney ? 'Margin trend' : 'Units and pace'} hint={`${rangeLabel(period)}, by ${bucket}`} action={seesMoney ? <SeeAll href={routes.profit({ by: bucket, from: period.from, to: period.to })}>Open in Profit</SeeAll> : undefined} testId="home-trend">
          {trend.isError ? (
            <LoadError what="the trend" onRetry={() => void trend.refetch()} compact />
          ) : seesMoney ? (
            <ComboChart
              title="Revenue, cost and margin over time"
              description="Bars show revenue and cost. The line on top is the margin after all costs, next to your target margin."
              loading={!trend.data}
              refreshing={trend.isFetching && Boolean(trend.data)}
              dates={dates}
              bucket={bucket}
              bars={[
                { id: 'revenue', label: 'Revenue', values: points.map((row) => row.revenueCents) },
                { id: 'cost', label: 'Cost', values: points.map((row) => row.costCents) },
              ]}
              lines={[{ id: 'margin', label: 'Margin after all costs', values: points.map((row) => row.marginBp) }]}
              barFormat="money"
              lineFormat="percent"
              lineTarget={{ value: targetMarginBp, label: 'Target margin' }}
              height={300}
              tableToggle
              emptyTitle="No work in this period yet"
              emptyHint="Log a day of work and the trend starts here."
            />
          ) : (
            <ComboChart
              title="Units finished and pace over time"
              description="Bars show good units. The line on top is units per person per hour."
              loading={!trend.data}
              refreshing={trend.isFetching && Boolean(trend.data)}
              dates={dates}
              bucket={bucket}
              bars={[{ id: 'units', label: 'Units', values: points.map((row) => num(row.unitsGood)) }]}
              lines={[{ id: 'uph', label: 'Units per person per hour', values: points.map((row) => num(row.uph)) }]}
              barFormat="number"
              lineFormat="number"
              height={300}
              tableToggle
              emptyTitle="No work in this period yet"
              emptyHint="Log a day of work and the trend starts here."
            />
          )}
        </Section>

        {seesMoney ? (
          <Section title="Where the cost went" hint={rangeLabel(period)} action={<ExplainNumber metric="cost" scope={scope} />} testId="home-cost-split">
            <DonutChart title="Cost split" description="Each slice is one kind of cost." loading={!total} slices={cost} format="money" centerLabel="total cost" emptyTitle="No costs in this period yet" emptyHint="Costs show up as work is logged." />
          </Section>
        ) : (
          <Section title="Hours on jobs and off" hint={rangeLabel(period)} testId="home-hours-split">
            <DonutChart title="Where paid time went" description="Hours on jobs against hours not on a job." loading={!bridge} slices={bridge ? [{ id: 'on', label: 'On jobs', value: Number(bridge.directHours) }, { id: 'off', label: 'Not on a job', value: Number(bridge.indirectHours) }, { id: 'missing', label: 'Paid, not logged', value: Number(bridge.missingHours) }].filter((slice) => slice.value > 0) : []} format="hours" centerLabel="hours" emptyTitle="No hours in this period yet" emptyHint="Hours show up as work is logged." />
          </Section>
        )}
      </div>

      {/* Best and worst */}
      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            { id: 'client', title: seesMoney ? 'Profit by client' : 'Units by client', query: byClient, rows: clientRows, link: routes.profit({ by: 'client' }), all: 'All clients' },
            { id: 'type', title: seesMoney ? 'Profit by job type' : 'Units by job type', query: byType, rows: typeRows, link: routes.profit({ by: 'type' }), all: 'All job types' },
          ] as const
        ).map((panel) => (
          <Section key={panel.id} title={panel.title} hint={panel.rows.length < (panel.query.data?.rows.filter((row) => row.key !== 'none').length ?? 0) ? 'The best and the worst' : rangeLabel(period)} action={seesMoney ? <SeeAll href={panel.link}>{panel.all}</SeeAll> : undefined} testId={`home-by-${panel.id}`}>
            {panel.query.isError ? (
              <LoadError what={panel.title.toLowerCase()} onRetry={() => void panel.query.refetch()} compact />
            ) : (
              <BarChart
                title={panel.title}
                description={seesMoney ? 'Longer bars made more profit. Bars to the left lost money.' : 'Longer bars finished more units.'}
                loading={!panel.query.data}
                refreshing={panel.query.isFetching && Boolean(panel.query.data)}
                orientation="horizontal"
                labels={panel.rows.map((row) => rowLabel(panel.id, row))}
                series={[{ id: 'value', label: seesMoney ? 'Profit' : 'Units', values: panel.rows.map((row) => (seesMoney ? row.profitCents : num(row.unitsGood))) }]}
                format={seesMoney ? 'money' : 'number'}
                signColors
                hideLegend
                height={Math.max(160, panel.rows.length * 34 + 48)}
                emptyTitle="Nothing to rank yet"
                emptyHint="Work logged in this period shows up here."
              />
            )}
          </Section>
        ))}
      </div>

      {/* Money waiting and things to fix */}
      <div className="grid gap-4 lg:grid-cols-3">
        {seesMoney ? (
          <KpiTile label="Not billed yet" explain={<ExplainNumber metric="not_billed" scope={scope} />} loading={!data} value={data ? formatMoneyWhole(data.notBilledYetCents) : null} footer={<SeeAll href={routes.report('ready-to-bill')}>Ready to bill</SeeAll>} emptyText="Nothing waiting" />
        ) : null}
        <KpiTile label="Paid time not on any job" explain={<ExplainStatic title="Paid time not on any job" rule="For each site and day: paid hours, less hours on jobs, less time not on a job. It is never below zero." rows={bridge ? [{ label: 'Paid hours', value: formatHours(bridge.paidHours) }, { label: 'Hours on jobs', value: formatHours(bridge.directHours), kind: 'minus' }, { label: 'Time not on a job', value: formatHours(bridge.indirectHours), kind: 'minus' }, { label: 'Paid, on no job', value: formatHours(bridge.missingHours), kind: 'total' }] : []} footnote="Worked out day by day, so the lines above may not subtract to the total." />} loading={!bridge} value={bridge ? formatHours(bridge.missingHours, { style: 'unit', maxDigits: 0 }) : null} footer={<span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">{seesMoney && bridge?.missingCostCents ? <span className="tabular-nums">{formatMoney(bridge.missingCostCents, { cents: false })} of pay nobody logged</span> : <span>Hours paid that nobody logged</span>}<SeeAll href={routes.report('paid-time-not-on-any-job')}>See the days</SeeAll></span>} />
        <Section title="Things to fix" className={cn(!seesMoney && 'lg:col-span-2')} testId="home-fix">
          {!fix ? (
            <span role="status" aria-busy="true" className="ks-skeleton block h-10 rounded-md">
              <span className="sr-only">Loading things to fix</span>
            </span>
          ) : fixes.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-fg-secondary" data-testid="home-fix-empty">
              <CircleCheck aria-hidden className="size-4 text-success" />
              Nothing to fix. Every number on this page is complete.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {fixes.map((item) => (
                <li key={item.one} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-fg">
                    <Wrench aria-hidden className="size-4 shrink-0 text-[var(--label-orange-text)]" />
                    <span>
                      <strong className="font-semibold tabular-nums">{item.count}</strong> {item.count === 1 ? item.one : item.many}
                    </span>
                  </span>
                  <SeeAll href={item.href}>{item.action}</SeeAll>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {can('production:log') && !seesMoney ? (
        <div className="flex justify-start print:hidden">
          <ButtonLink href={routes.log()} icon={<ClipboardPen aria-hidden />}>
            Log today’s work
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
