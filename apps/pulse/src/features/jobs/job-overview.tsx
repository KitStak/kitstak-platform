'use client';
/**
 * Job overview: the verdict in plain words with the next step, the headline numbers (each with
 * "how we got this"), money over time, pace against the target, the estimate at completion
 * with what if sliders, linked records and the last entries.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import {
  ArrowRight,
  CircleAlert,
  ClipboardPen,
  Copy,
  ExternalLink,
  Link2,
  Pin,
  Plus,
  Unlink,
  Wrench,
} from 'lucide-react';
import {
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { AreaChart, LineChart } from '@/components/charts/cartesian';
import { DonutChart } from '@/components/charts/radial';
import { DeltaBadge, KpiTile, MarginPill, marginHealth } from '@/components/charts/stats';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { useShell } from '@/features/shell/shell-context';
import { PULSE_STATUS_LABELS } from '@/lib/constants';
import {
  formatHours,
  formatMoney,
  formatMoneyPerHour,
  formatMoneyPerUnit,
  formatNumber,
  formatPace,
  formatPercentBp,
  formatPercentDelta,
  formatUnits,
} from '@/lib/format';
import { absBig, centsToNumber, perHourCents, perUnitCents, subCents, toCents } from '@/lib/money';
import { CONFIDENCE_LABELS, paceDays, runningTotal, shouldCostPerUnit, unitsPerHour } from '@/lib/profit';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { JobDetailDTO, JobLinkDTO, LaborClassDTO, SettingsDTO, VasServiceDTO } from '@/lib/types';
import { addJobLinkAction, removeJobLinkAction } from '@/server/actions/jobs';
import { useJobDaily, useJobProduction, useRefreshJob } from './job-data';
import { nextStepHref, planInUse, planToTotals, rowPace, singularUnit, statsToActual } from './job-math';
import { Explain, UnitsProgress } from './job-ui';
import { JobWhatIf } from './job-whatif';
import { callAction, useJobActions } from './use-job-actions';

export interface JobTabProps {
  readonly job: JobDetailDTO;
  readonly today: string;
  readonly settings: SettingsDTO;
  readonly laborClasses: readonly LaborClassDTO[];
  readonly services: readonly VasServiceDTO[];
}

const LINK_WORDS: Readonly<Record<string, string>> = {
  crm_deal: 'CRM deal',
  crm_account: 'CRM account',
  wms_work_order: 'Warehouse work order',
  wms_shipment_order: 'Warehouse shipment',
  wms_client: 'Warehouse client',
  pm_project: 'Project',
  pm_task: 'Project task',
};

const BANNER: Readonly<Record<string, string>> = {
  losing: 'border-danger/40 bg-danger-subtle',
  at_risk: 'border-[var(--label-orange-bg)]/50 bg-[var(--label-orange-subtle)]',
  no_data: 'border-border-default bg-sunken',
  heads_up: 'border-[var(--label-yellow-bg)]/50 bg-[var(--label-yellow-subtle)]',
  on_track: 'border-success/40 bg-success-subtle',
};

const NEEDS: readonly {
  readonly key: string;
  readonly text: (count: number) => string;
  readonly action: string;
  readonly tab: 'plan' | 'money-in' | 'work' | 'labor';
}[] = [
  {
    key: 'noPlan',
    text: () => 'There is no quote or budget, so Pulse cannot say if the job is on plan.',
    action: 'Add a quote',
    tab: 'plan',
  },
  {
    key: 'noPrice',
    text: () => 'There is no price, so the work earns no revenue yet.',
    action: 'Add a price',
    tab: 'money-in',
  },
  {
    key: 'needsRate',
    text: (count) =>
      `${count} ${count === 1 ? 'entry has' : 'entries have'} hours with no labor rate, so their labor cost is missing.`,
    action: 'Add a labor rate',
    tab: 'labor',
  },
  {
    key: 'daysMissingHours',
    text: (count) =>
      `${count} ${count === 1 ? 'day has' : 'days have'} units with no hours, so labor cost is not complete yet.`,
    action: 'Add the hours',
    tab: 'work',
  },
  {
    key: 'serviceNoPrice',
    text: (count) => `${count} extra service ${count === 1 ? 'entry has' : 'entries have'} no price set yet.`,
    action: 'Set the price',
    tab: 'money-in',
  },
];

export function JobOverview({ job, today, settings, laborClasses, services }: JobTabProps) {
  const shell = useShell();
  const refresh = useRefreshJob();
  const actions = useJobActions();
  const stats = job.stats;
  const unit = singularUnit(job.unitLabel);
  const seesMoney = shell.seesMoney && !stats.moneyHidden;
  const production = useJobProduction(job.id);
  const daily = useJobDaily(job.number, seesMoney);

  const actual = statsToActual(stats);
  const plan = planToTotals(planInUse(job));
  const laborPerHour = stats.laborCents === null ? null : perHourCents(stats.laborCents, stats.hours);
  const costPerUnit =
    actual && Number(stats.unitsGood) > 0
      ? perUnitCents(toCents(stats.costCents ?? 0), stats.unitsGood)
      : null;
  const shouldCost = actual && plan && Number(stats.unitsGood) > 0 ? shouldCostPerUnit(plan, actual) : null;
  const planCostPerUnit =
    plan && plan.units !== null && Number(plan.units) > 0
      ? perUnitCents(
          toCents(plan.laborCents ?? 0) +
            toCents(plan.materialCents ?? 0) +
            toCents(plan.otherCents ?? 0) +
            toCents(plan.sharedCents ?? 0),
          plan.units,
        )
      : null;
  const health = stats.riskStatus
    ? null
    : marginHealth(stats.marginBp, stats.targetMarginBp ?? settings.defaultTargetMarginBp);

  const money = useMemo(() => {
    const rows = [...(daily.data?.rows ?? [])].sort((a, b) => a.key.localeCompare(b.key));
    return {
      labels: rows.map((row) => shortDate(row.key)),
      revenue: runningTotal(rows.map((row) => toCents(row.revenueCents ?? 0))).map((value) =>
        centsToNumber(value),
      ),
      cost: runningTotal(rows.map((row) => toCents(row.costCents ?? 0))).map((value) => centsToNumber(value)),
    };
  }, [daily.data]);

  const pace = useMemo(() => {
    const days = paceDays(
      (production.data ?? [])
        .filter((row) => row.deletedAt === null)
        .map((row) => ({
          workDate: row.workDate,
          unitsGood: row.unitsGood,
          hours: row.hours,
          setupHours: row.setupHours,
          hoursConfirmed: row.hoursConfirmed,
          source: row.source,
        })),
    );
    const counted = days.filter((day) => day.counted);
    return {
      labels: counted.map((day) => shortDate(day.workDate)),
      values: counted.map((day) => unitsPerHour(day.unitsGood, day.paceHours)),
    };
  }, [production.data]);

  const needs = NEEDS.map((item) => {
    const raw = stats.needs[item.key];
    const count = typeof raw === 'number' ? raw : raw === true ? 1 : 0;
    return { ...item, count };
  }).filter((item) => item.count > 0 && job.status !== 'cancelled');
  const steps = stats.riskReasons
    .filter(
      (reason, index, all) =>
        reason.nextStep && all.findIndex((other) => other.nextStep === reason.nextStep) === index,
    )
    .slice(0, 3);
  const recent = (production.data ?? []).filter((row) => row.deletedAt === null).slice(0, 7);
  const lateBy = job.dueDate && stats.projectedFinishDate && stats.projectedFinishDate > job.dueDate;

  return (
    <div className="flex flex-col gap-5" data-testid="job-overview">
      {job.pinnedNote ? (
        <p
          className="flex items-start gap-2 rounded-xl border border-border-subtle bg-panel px-4 py-3 text-sm text-fg"
          data-testid="job-pinned"
        >
          <Pin aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <span>{job.pinnedNote}</span>
        </p>
      ) : null}

      {/* The verdict: status, reasons, next steps, where it is heading. */}
      <section
        aria-label="Where this job stands"
        data-testid="job-verdict"
        className={cn(
          'rounded-xl border p-4 sm:p-5',
          stats.riskStatus ? BANNER[stats.riskStatus] : 'border-border-subtle bg-panel',
        )}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {stats.riskStatus ? (
                <MarginPill status={stats.riskStatus} />
              ) : (
                <span className="rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-fg-secondary">
                  {job.status === 'planned'
                    ? 'Not started'
                    : job.status === 'on_hold'
                      ? 'On hold'
                      : job.status === 'cancelled'
                        ? 'Cancelled'
                        : 'No status yet'}
                </span>
              )}
              {stats.laborMissing ? (
                <span className="rounded-sm bg-[var(--label-yellow-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--label-yellow-text)]">
                  Profit not complete yet
                </span>
              ) : null}
            </div>
            <p className="text-md font-semibold text-fg" data-testid="job-headline">
              {stats.headline ||
                (job.status === 'planned'
                  ? 'This job has not started. Start it when the work begins, and log the first day.'
                  : job.status === 'on_hold'
                    ? 'This job is on hold. Resume it when the work starts again.'
                    : job.status === 'cancelled'
                      ? 'This job was cancelled. Its entries still count in the months they were logged.'
                      : stats.riskStatus
                        ? `${PULSE_STATUS_LABELS[stats.riskStatus]}.`
                        : 'Log the first day of work to see where this job is heading.')}
            </p>
            {stats.riskReasons.length > 1 ? (
              <ul className="flex flex-col gap-1.5">
                {stats.riskReasons.slice(1, 5).map((reason) => (
                  <li key={reason.rule} className="flex items-start gap-2 text-sm text-fg">
                    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                    <span>{reason.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {steps.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {steps.map((step, index) => (
                  <ButtonLink
                    key={step.rule}
                    href={nextStepHref(step.nextStep, job)}
                    variant={index === 0 ? 'primary' : 'secondary'}
                    size="sm"
                    testId={`next-step-${step.nextStep}`}
                  >
                    {step.nextStepLabel}
                    <ArrowRight aria-hidden />
                  </ButtonLink>
                ))}
              </div>
            ) : null}
          </div>
          {seesMoney && stats.mode ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-panel/80 p-3.5">
              <p className="text-xs text-fg-muted">
                {stats.mode === 'final'
                  ? 'Final result'
                  : stats.mode === 'actuals'
                    ? 'Last 30 days'
                    : 'Heading for, at finish'}
              </p>
              <p
                className={cn(
                  'text-xl font-semibold tracking-tight tabular-nums',
                  (stats.projectedProfitCents ?? 0) < 0 ? 'text-danger-text' : 'text-fg',
                )}
                data-testid="job-projected-profit"
              >
                {formatMoney(stats.projectedProfitCents, { cents: false, empty: 'No projection yet' })}
              </p>
              <dl className="flex flex-col gap-1 text-sm tabular-nums">
                <div className="flex justify-between gap-3">
                  <dt className="text-fg-secondary">Margin</dt>
                  <dd className="font-medium text-fg">
                    {formatPercentBp(stats.projectedMarginBp, { empty: 'None yet' })}
                    {stats.targetMarginBp !== null ? (
                      <span className="ml-1 text-xs font-normal text-fg-muted">
                        target {formatPercentBp(stats.targetMarginBp, { digits: 0 })}
                      </span>
                    ) : null}
                  </dd>
                </div>
                {stats.mode === 'projected' ? (
                  <>
                    <div className="flex justify-between gap-3">
                      <dt className="text-fg-secondary">Finish</dt>
                      <dd className={cn('font-medium', lateBy ? 'text-danger-text' : 'text-fg')}>
                        {stats.projectedFinishDate ? shortDate(stats.projectedFinishDate) : 'Not known yet'}
                        {job.dueDate ? (
                          <span className="ml-1 text-xs font-normal text-fg-muted">
                            due {shortDate(job.dueDate)}
                          </span>
                        ) : null}
                      </dd>
                    </div>
                    {stats.confidence ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-fg-secondary">How sure</dt>
                        <dd className="font-medium text-fg">{CONFIDENCE_LABELS[stats.confidence]}</dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </dl>
            </div>
          ) : null}
        </div>
      </section>

      {needs.length > 0 ? (
        <section
          aria-label="Things to fix"
          className="rounded-xl border border-border-subtle bg-panel p-4"
          data-testid="job-needs"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Wrench aria-hidden className="size-4 text-fg-muted" />
            Things to fix so the numbers can be trusted
          </h2>
          <ul className="mt-2 flex flex-col divide-y divide-border-subtle">
            {needs.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm text-fg-secondary"
              >
                <span className="min-w-0 flex-1">{item.text(item.count)}</span>
                <Link
                  href={item.tab === 'labor' ? routes.labor('rates') : routes.jobTab(job.number, item.tab)}
                  className="inline-flex items-center gap-1 rounded-sm font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {item.action}
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Headline numbers. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="job-tiles">
        {seesMoney ? (
          <>
            <KpiTile
              label="Revenue earned"
              value={formatMoney(stats.revenueCents, { cents: false })}
              footer={
                <span className="text-xs text-fg-muted">
                  Billed {formatMoney(stats.billedCents, { cents: false })}
                </span>
              }
              explain={
                <Explain
                  title="Revenue earned"
                  rule="Revenue is earned when the work is done, not when the invoice goes out. It is the units made times the price, plus extra services, plus fees, less credits."
                  rows={[
                    {
                      label:
                        job.pricingModel === 'per_unit'
                          ? `${formatUnits(stats.unitsGood, unit)} at the price`
                          : job.pricingModel === 'hourly'
                            ? 'Hours at the billing rate'
                            : 'Share of the fixed price earned',
                      value: formatMoney(stats.baseRevenueCents),
                    },
                    { label: 'Extra services', value: formatMoney(stats.vasRevenueCents) },
                    { label: 'Fees, corrections and credits', value: formatMoney(stats.otherRevenueCents) },
                    { label: 'Revenue earned', value: formatMoney(stats.revenueCents), kind: 'total' },
                  ]}
                />
              }
            />
            <KpiTile
              label={job.status === 'completed' ? 'Final cost' : 'Cost so far'}
              value={formatMoney(stats.costCents, { cents: false })}
              footer={
                costPerUnit !== null ? (
                  <span className="text-xs text-fg-muted">{formatMoneyPerUnit(costPerUnit, unit)}</span>
                ) : undefined
              }
              explain={
                <Explain
                  title="Cost so far"
                  rule="Every cost this job has run up: labor at the real cost of an hour, material, other costs, and its share of time not on a job."
                  rows={[
                    {
                      label: `Labor, ${formatHours(stats.hours, { style: 'unit', maxDigits: 0 })}`,
                      value: formatMoney(stats.laborCents),
                    },
                    ...(laborPerHour !== null
                      ? [
                          {
                            label: 'Average real cost of an hour',
                            value: formatMoneyPerHour(laborPerHour),
                            kind: 'note' as const,
                          },
                        ]
                      : []),
                    { label: 'Material', value: formatMoney(stats.materialCents) },
                    { label: 'of that, scrap', value: formatMoney(stats.scrapCents), kind: 'note' },
                    { label: 'Other costs', value: formatMoney(stats.otherCents) },
                    { label: 'Time not on a job', value: formatMoney(stats.sharedCents) },
                    { label: 'Cost so far', value: formatMoney(stats.costCents), kind: 'total' },
                  ]}
                />
              }
            />
            <KpiTile
              label={job.status === 'completed' ? 'Final profit' : 'Profit so far'}
              value={formatMoney(stats.profitCents, { cents: false })}
              footer={
                stats.mode === 'projected' ? (
                  <span className="text-xs text-fg-muted">
                    Heading for {formatMoney(stats.projectedProfitCents, { cents: false })}
                  </span>
                ) : undefined
              }
              explain={
                <Explain
                  title="Profit so far"
                  rule="Profit is revenue earned less every cost."
                  rows={[
                    { label: 'Revenue earned', value: formatMoney(stats.revenueCents) },
                    { label: 'Cost so far', value: formatMoney(stats.costCents), kind: 'minus' },
                    { label: 'Profit so far', value: formatMoney(stats.profitCents), kind: 'total' },
                  ]}
                  footnote={
                    stats.laborMissing
                      ? 'Some days have units with no hours or hours with no rate, so this profit is not complete yet.'
                      : undefined
                  }
                />
              }
            />
            <KpiTile
              label="Margin after all costs"
              value={stats.marginBp === null ? null : formatPercentBp(stats.marginBp)}
              emptyText="No revenue yet"
              footer={
                <>
                  {health ? <MarginPill health={health} size="sm" /> : null}
                  <span className="text-xs text-fg-muted">
                    {stats.targetMarginBp !== null
                      ? `Target ${formatPercentBp(stats.targetMarginBp, { digits: 0 })}. `
                      : ''}
                    Before time not on a job:{' '}
                    {formatPercentBp(stats.marginBeforeSharedBp, { empty: 'none yet' })}
                  </span>
                </>
              }
              explain={
                <Explain
                  title="Margin after all costs"
                  rule="Margin is profit as a share of revenue. The second number leaves out time not on a job, to show what the job earns on its own."
                  rows={[
                    { label: 'Profit so far', value: formatMoney(stats.profitCents) },
                    { label: 'Revenue earned', value: formatMoney(stats.revenueCents) },
                    {
                      label: 'Margin',
                      value: formatPercentBp(stats.marginBp, { empty: 'No revenue yet' }),
                      kind: 'total',
                    },
                    {
                      label: 'Before time not on a job',
                      value: formatPercentBp(stats.marginBeforeSharedBp, { empty: 'No revenue yet' }),
                      kind: 'note',
                    },
                  ]}
                />
              }
            />
          </>
        ) : null}
        <KpiTile
          label={`${job.unitLabel.charAt(0).toUpperCase()}${job.unitLabel.slice(1)} done`}
          value={formatNumber(stats.unitsGood, { maxDigits: 0 })}
          footer={
            <UnitsProgress
              done={stats.unitsGood}
              planned={job.plannedUnits}
              pctBp={stats.pctCompleteBp}
              unit={job.unitLabel}
            />
          }
          explain={
            <Explain
              title="Units done"
              rule="Good units from every work entry on this job. Scrap and rework are counted apart and never earn revenue."
              rows={[
                { label: 'Good units', value: formatNumber(stats.unitsGood) },
                { label: 'Scrapped', value: formatNumber(stats.unitsScrap), kind: 'note' },
                { label: 'Reworked', value: formatNumber(stats.unitsRework), kind: 'note' },
                {
                  label: 'Planned',
                  value: Number(job.plannedUnits) > 0 ? formatNumber(job.plannedUnits) : 'Not set',
                  kind: 'note',
                },
              ]}
            />
          }
        />
        <KpiTile
          label="Pace"
          value={stats.uph === null ? null : formatPace(stats.uph)}
          emptyText="No counted day yet"
          footer={
            stats.standardUph !== null ? (
              <>
                {stats.productivityBp !== null ? (
                  <DeltaBadge
                    delta={stats.productivityBp - 10000}
                    text={formatPercentDelta(stats.productivityBp - 10000, { digits: 0 })}
                    size="sm"
                  />
                ) : null}
                <span className="text-xs text-fg-muted">target {formatPace(stats.standardUph)}</span>
              </>
            ) : (
              <span className="text-xs text-fg-muted">No target pace set</span>
            )
          }
          explain={
            <Explain
              title="Pace"
              rule={`Pace is ${job.unitLabel} per person per hour: good units over labor hours on the days that count. Setup hours and days with missing hours are left out so the pace is fair.`}
              rows={[
                { label: 'Good units', value: formatNumber(stats.unitsGood) },
                { label: 'Hours that count', value: formatHours(stats.paceHours) },
                { label: 'Setup hours left out', value: formatHours(stats.setupHours), kind: 'note' },
                { label: 'Pace', value: formatPace(stats.uph, { empty: 'None yet' }), kind: 'total' },
                {
                  label: 'Target pace',
                  value: formatPace(stats.standardUph, { empty: 'Not set' }),
                  kind: 'note',
                },
              ]}
            />
          }
        />
        {seesMoney ? (
          <>
            <KpiTile
              label={`Cost for one ${unit}`}
              value={costPerUnit === null ? null : formatMoney(costPerUnit)}
              emptyText="No units yet"
              footer={
                shouldCost !== null && costPerUnit !== null ? (
                  <>
                    <DeltaBadge
                      delta={subCents(costPerUnit, shouldCost)}
                      text={formatMoney(absBig(subCents(costPerUnit, shouldCost)))}
                      goodWhen="down"
                      size="sm"
                    />
                    <span className="text-xs text-fg-muted">should cost {formatMoney(shouldCost)}</span>
                  </>
                ) : planCostPerUnit !== null ? (
                  <span className="text-xs text-fg-muted">the plan says {formatMoney(planCostPerUnit)}</span>
                ) : (
                  <span className="text-xs text-fg-muted">
                    {plan ? 'Shows up after the first units' : 'Add a plan to see what it should cost'}
                  </span>
                )
              }
              explain={
                <Explain
                  title={`Cost for one ${unit}`}
                  rule="All cost so far over the good units made. Should cost is the plan's cost for the same number of units."
                  rows={[
                    { label: 'Cost so far', value: formatMoney(stats.costCents) },
                    { label: 'Good units', value: formatNumber(stats.unitsGood) },
                    {
                      label: `Cost for one ${unit}`,
                      value: costPerUnit === null ? 'No units yet' : formatMoney(costPerUnit),
                      kind: 'total',
                    },
                    {
                      label: 'Should cost, from the plan',
                      value: shouldCost === null ? 'No plan' : formatMoney(shouldCost),
                      kind: 'note',
                    },
                  ]}
                />
              }
            />
            <KpiTile
              label="Not billed yet"
              value={formatMoney(stats.notBilledYetCents, { cents: false })}
              footer={
                <Link
                  href={routes.jobTab(job.number, 'money-in')}
                  className="rounded-sm text-xs font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  See invoices
                </Link>
              }
              explain={
                <Explain
                  title="Not billed yet"
                  rule="Revenue the work has earned that no approved invoice covers yet."
                  rows={[
                    { label: 'Revenue earned', value: formatMoney(stats.revenueCents) },
                    { label: 'Billed on invoices', value: formatMoney(stats.billedCents), kind: 'minus' },
                    { label: 'Not billed yet', value: formatMoney(stats.notBilledYetCents), kind: 'total' },
                  ]}
                />
              }
            />
          </>
        ) : (
          <>
            <KpiTile
              label="Labor hours"
              explain={
                <Explain
                  title="Labor hours"
                  rule="People times hours each, added up over every row on the work log. Overtime hours are part of the total."
                  rows={[
                    { label: 'Hours logged', value: formatHours(stats.hours), kind: 'total' },
                    { label: 'of that, overtime', value: formatHours(stats.overtimeHours), kind: 'note' },
                  ]}
                />
              }
              value={formatHours(stats.hours, { maxDigits: 0 })}
              footer={
                job.planLaborHours ? (
                  <span className="text-xs text-fg-muted">
                    plan {formatHours(job.planLaborHours, { maxDigits: 0 })}
                  </span>
                ) : undefined
              }
            />
            <KpiTile
              label="Last entry"
              explain={
                <Explain
                  title="Last entry"
                  rule="The latest day with a row on the work log for this job. A job with no entry for a few work days gets a heads up."
                  rows={[{ label: 'Rows on the work log', value: formatNumber(stats.entryCount), kind: 'total' }]}
                />
              }
              value={stats.lastEntryDate ? shortDate(stats.lastEntryDate) : null}
              emptyText="None yet"
              footer={<span className="text-xs text-fg-muted">{stats.entryCount} entries</span>}
            />
          </>
        )}
      </div>

      {/* Charts. */}
      <div className="grid gap-5 lg:grid-cols-2">
        {seesMoney ? (
          <Panel title="Money over time" bodyClassName="p-4 min-w-0">
            <AreaChart
              title="Revenue earned and cost, added up day by day"
              description="When the cost line sits above the revenue line, the job is in the red."
              labels={money.labels}
              series={[
                { id: 'revenue', label: 'Revenue earned so far', values: money.revenue },
                { id: 'cost', label: 'Cost so far', values: money.cost },
              ]}
              format="money"
              height={240}
              loading={daily.isPending}
              error={daily.isError ? 'This chart could not load.' : null}
              onRetry={() => void daily.refetch()}
              emptyTitle="No money logged yet"
              emptyHint="Log a day of work and the lines start here."
              tableToggle
            />
          </Panel>
        ) : null}
        <Panel title="Pace against the target" bodyClassName="p-4 min-w-0">
          <LineChart
            title={`${job.unitLabel} per person per hour, day by day`}
            description="Each point is one day that counts. The dashed line is the target pace."
            labels={pace.labels}
            series={[{ id: 'pace', label: 'Pace', values: pace.values }]}
            target={
              stats.standardUph !== null
                ? { value: Number(stats.standardUph), label: 'Target pace' }
                : undefined
            }
            format="number"
            height={240}
            zeroBased
            loading={production.isPending}
            error={production.isError ? 'This chart could not load.' : null}
            onRetry={() => void production.refetch()}
            emptyTitle="No counted day yet"
            emptyHint="A day counts when it has units and labor hours."
            emptyAction={
              shell.can('production:log') ? (
                <ButtonLink href={routes.jobTab(job.number, 'work')} size="sm" variant="secondary">
                  Log a day
                </ButtonLink>
              ) : undefined
            }
            tableToggle
          />
        </Panel>
      </div>

      {seesMoney && (stats.costCents ?? 0) > 0 ? (
        <Panel title="Where the cost went" bodyClassName="p-4 min-w-0">
          <DonutChart
            title="Cost so far by kind"
            slices={[
              { id: 'labor', label: 'Labor', value: stats.laborCents ?? 0 },
              { id: 'material', label: 'Material', value: stats.materialCents ?? 0 },
              { id: 'other', label: 'Other costs', value: stats.otherCents ?? 0 },
              { id: 'shared', label: 'Time not on a job', value: stats.sharedCents ?? 0 },
            ]}
            format="money"
            centerLabel="cost so far"
            height={180}
            tableToggle
          />
        </Panel>
      ) : null}

      {seesMoney ? (
        <JobWhatIf job={job} today={today} settings={settings} laborClasses={laborClasses} />
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          title="Latest work"
          action={
            <ButtonLink href={routes.jobTab(job.number, 'work')} variant="ghost" size="sm">
              See the work log
            </ButtonLink>
          }
          bodyClassName="p-0"
        >
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-secondary">
              {production.isPending
                ? 'Loading the entries.'
                : 'No work logged yet. The first day you log shows up here.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Latest work entries">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Day</TableHeaderCell>
                    <TableHeaderCell numeric>Good {job.unitLabel}</TableHeaderCell>
                    <TableHeaderCell numeric>Labor hours</TableHeaderCell>
                    <TableHeaderCell numeric>Pace</TableHeaderCell>
                    {seesMoney ? <TableHeaderCell numeric>Labor cost</TableHeaderCell> : null}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recent.map((row) => {
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">{shortDate(row.workDate)}</TableCell>
                        <TableCell numeric>{formatNumber(row.unitsGood, { maxDigits: 0 })}</TableCell>
                        <TableCell numeric>
                          {row.hoursConfirmed ? (
                            formatHours(row.hours)
                          ) : (
                            <span className="text-[var(--label-yellow-text)]">Add hours</span>
                          )}
                        </TableCell>
                        <TableCell numeric>{formatPace(rowPace(row), { empty: '' })}</TableCell>
                        {seesMoney ? (
                          <TableCell numeric>
                            {formatMoney(row.laborCostCents, { empty: 'Hidden' })}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Quick actions">
            <div className="flex flex-col gap-2" data-testid="job-quick-actions">
              {shell.can('production:log') ? (
                <ButtonLink
                  href={routes.jobTab(job.number, 'work')}
                  variant="secondary"
                  icon={<ClipboardPen aria-hidden />}
                  className="justify-start"
                >
                  {job.status === 'completed' || job.status === 'cancelled' ? 'Add a late day' : 'Log today'}
                </ButtonLink>
              ) : null}
              {shell.can('cost:manage') ? (
                <ButtonLink
                  href={`${routes.jobTab(job.number, 'materials')}#other-costs`}
                  variant="secondary"
                  icon={<Plus aria-hidden />}
                  className="justify-start"
                  testId="quick-add-cost"
                >
                  Add a cost
                </ButtonLink>
              ) : null}
              {shell.can('revenue:manage') ? (
                <ButtonLink
                  href={`${routes.jobTab(job.number, 'money-in')}#invoices`}
                  variant="secondary"
                  icon={<Plus aria-hidden />}
                  className="justify-start"
                  testId="quick-add-revenue"
                >
                  Add an invoice or a fee
                </ButtonLink>
              ) : null}
              {shell.can('vas:manage') && services.length > 0 ? (
                <ButtonLink
                  href={`${routes.jobTab(job.number, 'money-in')}#extra-services`}
                  variant="secondary"
                  icon={<Plus aria-hidden />}
                  className="justify-start"
                  testId="quick-add-service"
                >
                  Add an extra service
                </ButtonLink>
              ) : null}
              {shell.can('job:manage') ? (
                <Button
                  variant="secondary"
                  leadingIcon={<Copy aria-hidden />}
                  className="justify-start"
                  loading={actions.busy}
                  onClick={() => void actions.duplicate(job)}
                  data-testid="quick-copy"
                >
                  Copy this job
                </Button>
              ) : null}
            </div>
          </Panel>
          <LinkedRecords job={job} canManage={shell.can('job:manage')} onChanged={refresh} />
        </div>
      </div>

    </div>
  );
}

function LinkedRecords({
  job,
  canManage,
  onChanged,
}: {
  readonly job: JobDetailDTO;
  readonly canManage: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const remove = async (link: JobLinkDTO) => {
    const gone = await removeJobLinkAction({ linkId: link.id });
    if (!gone.ok) {
      toast.error("Couldn't remove the link", gone.error.message);
      return;
    }
    await onChanged();
    toast.undo(`Removed the link to ${link.title ?? LINK_WORDS[link.targetType] ?? 'the record'}`, {
      onUndo: async () => {
        const back = await callAction(
          addJobLinkAction({
            jobId: job.id,
            link: {
              targetType: link.targetType,
              targetId: link.targetId,
              importsTime: link.importsTime,
              title: link.title,
              status: link.status,
            },
          }),
          "Couldn't bring the link back",
        );
        if (back) await onChanged();
      },
    });
  };
  return (
    <Panel title="Linked records">
      {job.links.length === 0 ? (
        <p className="flex items-start gap-2 text-sm text-fg-secondary" data-testid="job-links-empty">
          <Link2 aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          Nothing linked. A job made from a CRM deal, a warehouse work order or a project shows that record
          here, so you can jump between the apps.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="job-links">
          {job.links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{link.title ?? link.targetId}</p>
                <p className="text-xs text-fg-muted">
                  {LINK_WORDS[link.targetType] ?? 'Record'}
                  {link.status ? ` · ${link.status}` : ''}
                </p>
              </div>
              {link.url ? (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${link.title ?? 'the record'} in a new tab`}
                  className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <ExternalLink aria-hidden className="size-4" />
                </a>
              ) : null}
              {canManage ? (
                <IconButton
                  label={`Remove the link to ${link.title ?? 'this record'}`}
                  icon={<Unlink aria-hidden />}
                  size="sm"
                  onClick={() => void remove(link)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
