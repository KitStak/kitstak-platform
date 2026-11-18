'use client';
/**
 * Plan vs actual: the plan (budget, else quote) next to what happened, with the difference in
 * dollars and percent and where the job is heading; the Quote vs actual view with its line by
 * line table; and "Why profit changed", a waterfall whose bars add up exactly to the gap.
 */
import { useMemo, useState } from 'react';
import { Calculator, ClipboardList, FilePlus2, Pencil, Trash2 } from 'lucide-react';
import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  ToggleGroup,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { WaterfallChart } from '@/components/charts/cartesian';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { useShell } from '@/features/shell/shell-context';
import {
  formatHours,
  formatHoursDelta,
  formatMoney,
  formatMoneyDelta,
  formatNumber,
  formatNumberDelta,
  formatPace,
  formatPercentBp,
  formatPercentDelta,
  formatPointsDelta,
} from '@/lib/format';
import { centsToNumber, mulHoursRate, toCents, type Cents } from '@/lib/money';
import {
  biggestDrag,
  biggestLift,
  factorBp,
  planVsActual,
  quoteLinesVsActual,
  quoteToBudget,
  varianceReading,
  varianceWaterfall,
  type ActualBucket,
  type PlanLine,
  type PlanRow,
  type PlanRowKey,
  type VarianceMode,
} from '@/lib/profit';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { JobPlanDTO } from '@/lib/types';
import { deletePlanAction, makeBudgetFromQuoteAction, savePlanAction } from '@/server/actions/jobs';
import { PlanDialog } from './forms/job-dialogs';
import { useJobCosts, useJobProduction, useJobProjection, useJobServices, useRefreshJob } from './job-data';
import { paceYardsticks, planPace } from './job-figures';
import { planToTotals, statsToActual } from './job-math';
import type { JobTabProps } from './job-overview';
import { Explain, LoadError, toneClass } from './job-ui';
import { callAction } from './use-job-actions';

const ZERO = BigInt(0);
const QUOTE_ROWS: readonly PlanRowKey[] = [
  'units',
  'labor_hours',
  'labor',
  'material',
  'other',
  'revenue',
  'margin',
];
const ORIGIN_WORDS: Readonly<Record<string, string>> = {
  typed: 'Typed in',
  csv: 'From a spreadsheet',
  calculator: 'From the calculator',
  crm_deal: 'From the CRM deal',
  wms_contract: 'From the warehouse contract rate',
  copied_from_quote: 'Copied from the quote',
  sample: 'Sample data',
};
const CATEGORY_WORDS: Readonly<Record<string, string>> = {
  revenue: 'Revenue',
  labor: 'Labor',
  setup: 'Setup',
  material: 'Material',
  other: 'Other cost',
};

function cell(row: PlanRow, value: number | Cents | null): string {
  if (value === null) return 'None';
  if (row.kind === 'money') return formatMoney(value as Cents);
  if (row.kind === 'hours') return formatHours(value as number);
  if (row.kind === 'pace') return formatPace(value as number);
  if (row.kind === 'margin') return formatPercentBp(value as number);
  return formatNumber(value as number, { maxDigits: 0 });
}

function difference(row: PlanRow): string {
  if (row.difference === null) return '';
  if (row.kind === 'money') return formatMoneyDelta(row.difference);
  if (row.kind === 'hours') return formatHoursDelta(row.difference);
  if (row.kind === 'margin') return formatPointsDelta(row.difference);
  return formatNumberDelta(row.difference, { maxDigits: row.kind === 'pace' ? 1 : 0 });
}

export function JobPlan({ job, today, settings, laborClasses }: JobTabProps) {
  const shell = useShell();
  const refresh = useRefreshJob();
  const canPlan = shell.can('plan:manage');
  const completed = job.status === 'completed';
  const [view, setView] = useState<'plan' | 'quote'>('plan');
  const [against, setAgainst] = useState<'budget' | 'quote'>(job.budget ? 'budget' : 'quote');
  // With no work logged the plan for the work done is all zeros, so the whole job plan is the useful view.
  const nothingDone = Number(job.stats.unitsGood) === 0 && Number(job.stats.hours) === 0;
  const [basis, setBasis] = useState<'so_far' | 'whole'>(completed || nothingDone ? 'whole' : 'so_far');
  const [mode, setMode] = useState<VarianceMode>(completed ? 'whole_job' : 'so_far');
  const [editing, setEditing] = useState<'quote' | 'budget' | null>(null);
  const [busy, setBusy] = useState(false);
  const projection = useJobProjection(job, today, settings, laborClasses);
  const production = useJobProduction(job.id);
  const serviceRows = useJobServices(job.id);
  const costRows = useJobCosts(job.id);

  const actual = statsToActual(job.stats);
  const chosen: JobPlanDTO | null =
    view === 'quote' ? job.quote : against === 'budget' ? (job.budget ?? job.quote) : job.quote;
  const plan = planToTotals(chosen);
  const projected = projection.projection?.mode === 'projected' ? projection.projection.atFinish : null;
  const serviceCostLeft =
    projection.projection?.mode === 'projected' && projection.projection.serviceCostLeftCents > BigInt(0)
      ? projection.projection.serviceCostLeftCents
      : null;

  const table = useMemo(
    () =>
      actual
        ? planVsActual({ plan, actual, basis: view === 'quote' && completed ? 'whole' : basis, projected })
        : null,
    [actual, plan, basis, projected, view, completed],
  );
  const waterfallMode: VarianceMode = completed ? 'whole_job' : mode === 'whole_job' ? 'so_far' : mode;
  const waterfall = useMemo(() => {
    if (!actual || !plan) return null;
    if (waterfallMode === 'at_finish')
      return projected ? varianceWaterfall({ plan, actual: projected, mode: 'at_finish' }) : null;
    return varianceWaterfall({ plan, actual, mode: waterfallMode });
  }, [actual, plan, projected, waterfallMode]);

  const lineRows = useMemo(() => {
    const quote = job.quote;
    if (!quote || quote.lines.length === 0 || !actual) return null;
    const lines: PlanLine[] = quote.lines.map((line) => ({
      category: line.category,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitAmount: line.unitAmount,
      amountCents: toCents(line.amountCents ?? 0),
      laborClass: line.laborClassId,
      serviceCode: line.vasServiceId,
      itemSku: line.itemId,
    }));
    const buckets: ActualBucket[] = [];
    const services = (serviceRows.data ?? []).filter((row) => row.deletedAt === null);
    const serviceMaterial = services.reduce((sum, row) => sum + toCents(row.materialCents ?? 0), ZERO);
    buckets.push({
      category: 'revenue',
      amountCents: toCents(job.stats.baseRevenueCents ?? 0) + toCents(job.stats.otherRevenueCents ?? 0),
    });
    for (const row of services) {
      buckets.push({
        category: 'revenue',
        serviceCode: row.vasServiceId,
        amountCents: toCents(row.amountCents ?? 0),
      });
      buckets.push({
        category: 'other',
        serviceCode: row.vasServiceId,
        amountCents:
          toCents(row.laborCostCents ?? 0) + toCents(row.materialCents ?? 0) + toCents(row.sharedCents ?? 0),
      });
    }
    for (const row of (production.data ?? []).filter((item) => item.deletedAt === null)) {
      const labor = toCents(row.laborCostCents ?? 0);
      // The setup share of a row is its setup hours at the row's own stamped rate.
      const setupRaw = Number(row.setupHours) > 0 ? mulHoursRate(row.setupHours, row.rateCents ?? 0) : ZERO;
      const setup = setupRaw > labor ? labor : setupRaw;
      if (setup > ZERO) buckets.push({ category: 'setup', laborClass: row.laborClassId, amountCents: setup });
      buckets.push({ category: 'labor', laborClass: row.laborClassId, amountCents: labor - setup });
    }
    buckets.push({
      category: 'material',
      amountCents: toCents(job.stats.materialCents ?? 0) - serviceMaterial,
    });
    for (const row of (costRows.data ?? []).filter((item) => item.deletedAt === null))
      buckets.push({ category: 'other', amountCents: toCents(row.amountCents ?? 0) });
    return quoteLinesVsActual(lines, buckets);
  }, [job.quote, job.stats, actual, serviceRows.data, production.data, costRows.data]);

  const bridge = useMemo(() => {
    const quote = planToTotals(job.quote);
    const budget = planToTotals(job.budget);
    return quote && budget ? quoteToBudget(quote, budget) : null;
  }, [job.quote, job.budget]);

  if (!actual)
    return <LoadError what="the plan" message="Your role does not show money, so this tab is hidden." />;

  const act = async <T,>(promise: Promise<T | undefined>, message: string): Promise<T | undefined> => {
    setBusy(true);
    const result = await promise;
    setBusy(false);
    if (result !== undefined) {
      await refresh();
      toast.success(message);
    }
    return result;
  };

  const deleteBudget = async () => {
    const budget = job.budget;
    if (!budget) return;
    setBusy(true);
    const gone = await deletePlanAction({ jobId: job.id, plan: 'budget' });
    setBusy(false);
    if (!gone.ok) {
      toast.error("Couldn't delete the budget", gone.error.message);
      return;
    }
    setAgainst('quote');
    await refresh();
    toast.undo('Deleted the budget. The job is judged by the quote again.', {
      onUndo: async () => {
        const back = await callAction(
          savePlanAction({
            jobId: job.id,
            plan: 'budget',
            input: {
              units: budget.units,
              revenueCents: budget.revenueCents ?? 0,
              laborHours: budget.laborHours,
              laborCents: budget.laborCents ?? 0,
              setupHours: budget.setupHours,
              setupCents: budget.setupCents ?? 0,
              materialCents: budget.materialCents ?? 0,
              otherCents: budget.otherCents ?? 0,
              sharedCents: budget.sharedAuto ? null : (budget.sharedCents ?? 0),
              origin: budget.origin,
              note: budget.note,
            },
          }),
          "Couldn't bring the budget back",
        );
        if (back) {
          setAgainst('budget');
          await refresh();
        }
      },
    });
  };

  if (!job.quote && !job.budget) {
    return (
      <Panel>
        <Teach
          testId="plan-empty"
          icon={ClipboardList}
          title="No plan yet"
          why="A plan is what you expected: the revenue, the labor hours and the costs. With one, Pulse shows where the job beat it and where it fell short, in dollars."
          points={[
            'Plan next to actual for units, hours, each cost, revenue and margin',
            'Why profit changed, bar by bar: price, labor, scrap, material',
            'Where the job is heading by the finish',
          ]}
          actions={
            canPlan ? (
              <>
                <Button
                  leadingIcon={<FilePlus2 aria-hidden />}
                  onClick={() => setEditing('quote')}
                  data-testid="plan-add-quote"
                >
                  Add a quote
                </Button>
                <ButtonLink
                  href={routes.calculator({ job: job.number })}
                  variant="secondary"
                  icon={<Calculator aria-hidden />}
                >
                  Work one out in the calculator
                </ButtonLink>
              </>
            ) : undefined
          }
          footnote={
            canPlan ? undefined : 'Your role can read plans but not change them. Ask a manager to add one.'
          }
        />
        {editing ? (
          <PlanDialog
            job={job}
            plan={null}
            kind={editing}
            open
            onOpenChange={(open) => (open ? undefined : setEditing(null))}
            onSaved={refresh}
          />
        ) : null}
      </Panel>
    );
  }

  const rows = (table?.rows ?? []).filter((row) => view === 'plan' || QUOTE_ROWS.includes(row.key));
  const showProjected = projected !== null;
  const done = table ? factorBp(table.factor) : null;
  const planWord = view === 'quote' || against === 'quote' || !job.budget ? 'quote' : 'budget';
  const drag = waterfall ? biggestDrag(waterfall.bars) : null;
  const lift = waterfall ? biggestLift(waterfall.bars) : null;
  const yardsticks = paceYardsticks({ uph: job.stats.uph, targetPace: job.stats.standardUph, planPace: planPace(plan), planWord });
  // Which plan the Plan view uses, in one line, so "Plan" never quietly means the quote.
  const planSource =
    view !== 'plan'
      ? null
      : !job.budget
        ? 'There is no budget yet, so your plan is the quote.'
        : against === 'quote'
          ? 'Compared with the quote, not your budget.'
          : 'Your plan is your budget.';

  return (
    <div className="flex flex-col gap-5" data-testid="job-plan">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          label="Which view"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'plan', label: 'Plan vs actual' },
            { value: 'quote', label: 'Quote vs actual', disabled: !job.quote },
          ]}
        />
        {view === 'plan' && job.budget && job.quote ? (
          <ToggleGroup
            label="Compare with"
            value={against}
            onValueChange={setAgainst}
            options={[
              { value: 'budget', label: 'Budget' },
              { value: 'quote', label: 'Quote' },
            ]}
          />
        ) : null}
        {!completed ? (
          <ToggleGroup
            label="How much of the plan"
            value={basis}
            onValueChange={setBasis}
            options={[
              { value: 'so_far', label: 'For the work done so far' },
              { value: 'whole', label: 'Whole job' },
            ]}
          />
        ) : null}
        {canPlan ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Pencil aria-hidden />}
              onClick={() => setEditing('quote')}
              data-testid="plan-edit-quote"
            >
              {job.quote ? 'Edit the quote' : 'Add a quote'}
            </Button>
            {job.budget ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Pencil aria-hidden />}
                  onClick={() => setEditing('budget')}
                  data-testid="plan-edit-budget"
                >
                  Edit the budget
                </Button>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  leadingIcon={<Trash2 aria-hidden />}
                  loading={busy}
                  onClick={() => void deleteBudget()}
                  data-testid="plan-delete-budget"
                >
                  Delete the budget
                </Button>
              </>
            ) : job.quote ? (
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={() =>
                  void act(
                    callAction(makeBudgetFromQuoteAction({ jobId: job.id }), "Couldn't make the budget"),
                    'Budget made from the quote. Edit it to match your own plan.',
                  ).then((made) => {
                    if (made) setAgainst('budget');
                  })
                }
                data-testid="plan-make-budget"
              >
                Make my own budget
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Panel
        title={view === 'quote' ? 'Quote vs actual' : 'Plan vs actual'}
        action={
          <Explain
            title="The plan column"
            rule={
              table?.planLabel === 'For the work done so far'
                ? 'A half done job should not be judged against the whole plan. So the plan is scaled to the share of the job that is done. Setup and other cost are not scaled.'
                : 'This compares what happened with the whole plan, from the first unit to the last.'
            }
            rows={
              done !== null && table?.factor.basis !== 'whole'
                ? [
                    {
                      label:
                        table?.factor.basis === 'units'
                          ? 'Share of the units done'
                          : 'Share of the plan hours used',
                      value: formatPercentBp(done),
                    },
                  ]
                : []
            }
            footnote={
              chosen
                ? `${ORIGIN_WORDS[chosen.origin] ?? 'Saved'}. Last changed ${shortDate(chosen.updatedAt.slice(0, 10))}.`
                : undefined
            }
            label="How the plan column is worked out"
          />
        }
        bodyClassName="p-0"
      >
        {planSource ? (
          <p className="border-b border-border-subtle px-4 py-2.5 text-sm text-fg-secondary" data-testid="plan-source">
            {planSource}
          </p>
        ) : null}
        {!table || !plan ? (
          <p className="p-4 text-sm text-fg-secondary">There is no {planWord} to compare with yet.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table aria-label={`${planWord} against actual`} data-testid="plan-table">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell> </TableHeaderCell>
                    <TableHeaderCell numeric>
                      {table.planLabel === 'Whole job'
                        ? `${planWord === 'budget' ? 'Budget' : 'Quote'}, whole job`
                        : `${planWord === 'budget' ? 'Budget' : 'Quote'}, for the work done`}
                    </TableHeaderCell>
                    <TableHeaderCell numeric>Actual</TableHeaderCell>
                    <TableHeaderCell numeric>Difference</TableHeaderCell>
                    <TableHeaderCell numeric>Difference %</TableHeaderCell>
                    {showProjected ? <TableHeaderCell numeric>Projected at finish</TableHeaderCell> : null}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.key}
                      data-testid={`plan-row-${row.key}`}
                      className={cn(
                        (row.key === 'cost' || row.key === 'profit') && 'font-semibold',
                        row.key === 'revenue' && 'border-t-2 border-t-border-default',
                      )}
                    >
                      <TableHeaderCell scope="row" className="text-sm font-medium text-fg">
                        {row.label}
                      </TableHeaderCell>
                      <TableCell numeric>{cell(row, row.plan)}</TableCell>
                      <TableCell numeric>{cell(row, row.actual)}</TableCell>
                      <TableCell numeric className={toneClass(row.tone)}>
                        {difference(row) || 'None'}
                        <span className="sr-only">
                          {row.tone === 'good'
                            ? ', better than plan'
                            : row.tone === 'bad'
                              ? ', worse than plan'
                              : ''}
                        </span>
                      </TableCell>
                      <TableCell numeric className={toneClass(row.tone)}>
                        {row.differencePctBp === null
                          ? ''
                          : formatPercentDelta(row.differencePctBp, { digits: 0 })}
                      </TableCell>
                      {showProjected ? <TableCell numeric>{cell(row, row.projected)}</TableCell> : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-border-subtle md:hidden" data-testid="plan-cards">
              {rows.map((row) => (
                <li key={row.key} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-fg">{row.label}</span>
                    <span className={cn('text-sm font-semibold tabular-nums', toneClass(row.tone))}>
                      {difference(row) || 'On plan'}
                      {row.differencePctBp !== null
                        ? ` (${formatPercentDelta(row.differencePctBp, { digits: 0 })})`
                        : ''}
                    </span>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                    <div>
                      <dt className="text-fg-muted">Plan</dt>
                      <dd className="text-fg">{cell(row, row.plan)}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Actual</dt>
                      <dd className="text-fg">{cell(row, row.actual)}</dd>
                    </div>
                    {showProjected ? (
                      <div>
                        <dt className="text-fg-muted">At finish</dt>
                        <dd className="text-fg">{cell(row, row.projected)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>
            <p className="border-t border-border-subtle px-4 py-2.5 text-xs text-fg-muted">
              Green means better than the plan, red means worse. For costs and hours, less is better.
              {yardsticks.againstPlan && rows.some((row) => row.key === 'uph')
                ? ` Units per person per hour is compared ${yardsticks.againstPlan}.`
                : ''}
              {yardsticks.conflict ? <span className="mt-1 block text-fg-secondary" data-testid="plan-pace-yardsticks">{yardsticks.conflict}</span> : null}
              {projection.loading
                ? ' Loading the projection.'
                : !showProjected && !completed && job.status === 'active'
                  ? ' There is no projection for this job, so that column is left out.'
                  : ''}
              {showProjected && serviceCostLeft !== null
                ? ` Projected other cost includes ${formatMoney(serviceCostLeft)} for extra services still to come.`
                : ''}
            </p>
          </>
        )}
      </Panel>

      {nothingDone && plan && !completed ? (
        <Panel title="Why profit changed" bodyClassName="p-4">
          <p className="text-sm text-fg-secondary" data-testid="waterfall-empty">
            No work is logged on this job yet. After the first day is in, this chart shows what moved profit away
            from the {planWord}: price, labor, scrap, material and time not on a job.
          </p>
        </Panel>
      ) : waterfall && plan ? (
        <Panel
          title="Why profit changed"
          action={
            !completed && projected ? (
              <ToggleGroup
                label="Which gap"
                size="sm"
                value={waterfallMode === 'at_finish' ? 'at_finish' : 'so_far'}
                onValueChange={(value) => setMode(value)}
                options={[
                  { value: 'so_far', label: 'So far' },
                  { value: 'at_finish', label: 'At finish' },
                ]}
              />
            ) : undefined
          }
          bodyClassName="p-4 min-w-0"
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <WaterfallChart
                title={
                  waterfallMode === 'so_far'
                    ? `From the ${planWord} for the work done to actual profit`
                    : waterfallMode === 'at_finish'
                      ? `From the whole ${planWord} to projected profit`
                      : `From the whole ${planWord} to final profit`
                }
                description="Each bar is one cause. Bars above zero helped profit, bars below hurt it. Together they add up exactly to the gap."
                start={{
                  label: waterfallMode === 'so_far' ? 'Plan so far' : 'Plan',
                  value: centsToNumber(waterfall.startCents),
                }}
                steps={waterfall.bars.map((bar) => ({
                  id: bar.key,
                  label: bar.label,
                  value: centsToNumber(bar.amountCents),
                }))}
                endLabel={waterfallMode === 'at_finish' ? 'Projected' : 'Actual'}
                format="money"
                upIsGood
                height={300}
                tableToggle
              />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1"
                data-testid="plan-explainers"
              >
                <Explainer
                  title="The gap"
                  value={formatMoneyDelta(waterfall.totalCents)}
                  tone={
                    waterfall.totalCents < ZERO ? 'bad' : waterfall.totalCents > ZERO ? 'good' : 'neutral'
                  }
                  text={
                    waterfall.totalCents === ZERO
                      ? 'Profit matches the plan.'
                      : waterfall.totalCents < ZERO
                        ? `Profit is under the ${planWord} by this much.`
                        : `Profit is over the ${planWord} by this much.`
                  }
                />
                <Explainer
                  title="Biggest drag"
                  value={drag ? formatMoneyDelta(drag.amountCents) : 'None'}
                  tone={drag ? 'bad' : 'neutral'}
                  text={drag ? varianceReading(drag, waterfall) : 'Nothing pulled profit down.'}
                />
                <Explainer
                  title="Biggest lift"
                  value={lift ? formatMoneyDelta(lift.amountCents) : 'None'}
                  tone={lift ? 'good' : 'neutral'}
                  text={lift ? varianceReading(lift, waterfall) : 'Nothing pushed profit up.'}
                />
              </div>
              <ul className="flex flex-col gap-1.5 text-sm text-fg-secondary" data-testid="plan-readings">
                {waterfall.bars
                  .filter((bar) => bar.amountCents !== ZERO && bar.key !== drag?.key && bar.key !== lift?.key)
                  .map((bar) => (
                    <li key={bar.key}>{varianceReading(bar, waterfall)}</li>
                  ))}
              </ul>
            </div>
          </div>
        </Panel>
      ) : projection.loading ? (
        <Skeleton height={200} />
      ) : null}

      {view === 'quote' && job.quote ? (
        <Panel title="The quote, line by line" bodyClassName="p-0">
          {!lineRows ? (
            <p className="p-4 text-sm text-fg-secondary">
              {production.isPending || serviceRows.isPending || costRows.isPending
                ? 'Loading the entries.'
                : 'This quote was saved as totals, with no lines, so the table above is the whole comparison. Jobs made in the new job wizard keep their lines, and each line is compared here.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Quote lines against actual" data-testid="quote-lines">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Line</TableHeaderCell>
                    <TableHeaderCell>Kind</TableHeaderCell>
                    <TableHeaderCell numeric>Quoted</TableHeaderCell>
                    <TableHeaderCell numeric>Actual so far</TableHeaderCell>
                    <TableHeaderCell numeric>Difference</TableHeaderCell>
                    <TableHeaderCell numeric>Difference %</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lineRows.map((row) => (
                    <TableRow key={row.index}>
                      <TableCell>
                        {row.description ?? CATEGORY_WORDS[row.category]}
                        {row.quotedQuantity !== null ? (
                          <span className="ml-1.5 text-xs text-fg-muted">
                            {formatNumber(row.quotedQuantity)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-fg-secondary">{CATEGORY_WORDS[row.category]}</TableCell>
                      <TableCell numeric>{formatMoney(row.quotedCents)}</TableCell>
                      <TableCell numeric>{formatMoney(row.actualCents)}</TableCell>
                      <TableCell numeric className={toneClass(completed ? row.tone : 'neutral')}>
                        {formatMoneyDelta(row.differenceCents)}
                      </TableCell>
                      <TableCell numeric className={toneClass(completed ? row.tone : 'neutral')}>
                        {row.differencePctBp === null
                          ? ''
                          : formatPercentDelta(row.differencePctBp, { digits: 0 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="border-t border-border-subtle px-4 py-2.5 text-xs text-fg-muted">
                {completed
                  ? 'The job is complete, so each line is judged against the whole quote.'
                  : 'The job is still running, so actual is less than the whole quote. The colors come on when the job is complete.'}{' '}
                Time not on a job has no quote line, so it is not in this table.
              </p>
            </div>
          )}
        </Panel>
      ) : null}

      {bridge ? (
        <Panel title="From the quote to your budget" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <Table aria-label="Quote against budget" data-testid="quote-to-budget">
              <TableHead>
                <TableRow className="hover:bg-transparent">
                  <TableHeaderCell> </TableHeaderCell>
                  <TableHeaderCell numeric>Quote</TableHeaderCell>
                  <TableHeaderCell numeric>Budget</TableHeaderCell>
                  <TableHeaderCell numeric>Gap</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bridge.rows.map((row) => (
                  <TableRow
                    key={row.key}
                    className={cn((row.key === 'cost' || row.key === 'profit') && 'font-semibold')}
                  >
                    <TableHeaderCell scope="row" className="text-sm font-medium text-fg">
                      {row.label}
                    </TableHeaderCell>
                    <TableCell numeric>{formatMoney(row.quoteCents)}</TableCell>
                    <TableCell numeric>{formatMoney(row.budgetCents)}</TableCell>
                    <TableCell numeric className={toneClass(row.tone)}>
                      {formatMoneyDelta(row.gapCents)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableHeaderCell scope="row" className="text-sm font-medium text-fg">
                    Margin
                  </TableHeaderCell>
                  <TableCell numeric>{formatPercentBp(bridge.quoteMarginBp, { empty: 'None' })}</TableCell>
                  <TableCell numeric>{formatPercentBp(bridge.budgetMarginBp, { empty: 'None' })}</TableCell>
                  <TableCell numeric>
                    {bridge.marginGapBp === null ? '' : formatPointsDelta(bridge.marginGapBp)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="border-t border-border-subtle px-4 py-2.5 text-xs text-fg-muted">
            The quote is what you sold. The budget is what you now plan to spend. The gap is the profit you
            gave up or found before the work started.
          </p>
        </Panel>
      ) : null}

      {editing ? (
        <PlanDialog
          job={job}
          plan={editing === 'quote' ? job.quote : job.budget}
          kind={editing}
          open
          onOpenChange={(open) => (open ? undefined : setEditing(null))}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}

function Explainer({
  title,
  value,
  text,
  tone,
}: {
  readonly title: string;
  readonly value: string;
  readonly text: string;
  readonly tone: 'good' | 'bad' | 'neutral';
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-sunken px-3 py-2.5">
      <p className="text-xs text-fg-muted">{title}</p>
      <p className={cn('text-md font-semibold tabular-nums', toneClass(tone))}>{value}</p>
      <p className="mt-0.5 text-xs text-fg-secondary">{text}</p>
    </div>
  );
}
