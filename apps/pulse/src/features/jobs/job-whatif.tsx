'use client';
/**
 * Estimate at completion with what if sliders. The starting point is the same projection the
 * server saved for the job, rebuilt here from the job's own rows. Moving a slider changes one
 * input and runs the library's `projectJob` again, so the answer follows the house math.
 */
import { useMemo, useState } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button, Skeleton } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import {
  formatHours,
  formatMoney,
  formatMoneyDelta,
  formatMoneyPerHour,
  formatNumber,
  formatPace,
  formatPercentBp,
  formatUnitPrice,
} from '@/lib/format';
import { centsToNumber } from '@/lib/money';
import { projectionNote } from '@/lib/profit';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { JobDetailDTO, LaborClassDTO, SettingsDTO } from '@/lib/types';
import { useJobProjection } from './job-data';
import { projectWhatIf, singularUnit } from './job-math';
import { Explain, LoadError } from './job-ui';

interface Sliders {
  readonly pace: number | null;
  readonly rateCents: number | null;
  readonly price: number | null;
  readonly units: number | null;
}

const NONE: Sliders = { pace: null, rateCents: null, price: null, units: null };

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format,
  base,
  testId,
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
  readonly format: (value: number) => string;
  readonly base: number;
  readonly testId: string;
}) {
  const changed = value !== base;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-fg">{label}</span>
        <span
          className={cn(
            'text-sm tabular-nums',
            changed ? 'font-semibold text-primary-text' : 'text-fg-secondary',
          )}
          data-testid={`${testId}-value`}
        >
          {format(value)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={format(value)}
        data-testid={testId}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-border-strong accent-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
      />
      <span className="flex justify-between text-2xs text-fg-muted">
        <span>{format(min)}</span>
        <span>{changed ? `now ${format(base)}` : hint}</span>
        <span>{format(max)}</span>
      </span>
    </label>
  );
}

const round = (value: number, step: number): number => Math.round(value / step) * step;

export function JobWhatIf({
  job,
  today,
  settings,
  laborClasses,
}: {
  readonly job: JobDetailDTO;
  readonly today: string;
  readonly settings: SettingsDTO;
  readonly laborClasses: readonly LaborClassDTO[];
}) {
  const {
    input: base,
    projection: baseline,
    error,
    retry,
  } = useJobProjection(job, today, settings, laborClasses);
  const [sliders, setSliders] = useState<Sliders>(NONE);
  const unit = singularUnit(job.unitLabel);
  const changed =
    sliders.pace !== null || sliders.rateCents !== null || sliders.price !== null || sliders.units !== null;
  const result = useMemo(() => {
    if (!base || !baseline) return null;
    if (!changed) return baseline;
    return projectWhatIf(
      base,
      {
        pace: sliders.pace,
        rateCents: sliders.rateCents,
        unitPrice: sliders.price === null ? null : sliders.price.toFixed(4),
        plannedUnits: sliders.units === null ? null : String(sliders.units),
      },
      baseline,
    );
  }, [base, baseline, sliders, changed]);

  const title = 'Estimate at completion';
  if (job.stats.moneyHidden) return null;
  if (error) {
    return (
      <Panel title={title}>
        <LoadError what="the entries behind the projection" onRetry={retry} />
      </Panel>
    );
  }
  if (!base || !baseline || !result) {
    return (
      <Panel title={title}>
        <div className="flex flex-col gap-3" role="status" aria-busy="true">
          <span className="sr-only">Loading the projection</span>
          <Skeleton height={20} className="w-2/3" />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      </Panel>
    );
  }

  if (baseline.mode !== 'projected') {
    return (
      <Panel title={title}>
        <p className="text-sm text-fg-secondary" data-testid="whatif-none">
          {projectionNote(baseline)}{' '}
          {job.status === 'planned' ? 'Start the job to see where it is heading.' : ''}
        </p>
        <div className="mt-3">
          <ButtonLink
            href={routes.calculator({ job: job.number })}
            variant="secondary"
            icon={<SlidersHorizontal aria-hidden />}
          >
            Try prices in the calculator
          </ButtonLink>
        </div>
      </Panel>
    );
  }

  const basePace = baseline.paceUph;
  const baseRate = baseline.rateLeftCents === null ? null : centsToNumber(baseline.rateLeftCents);
  const basePrice = job.pricingModel === 'per_unit' && job.unitPrice !== null ? Number(job.unitPrice) : null;
  const baseUnits = Number(job.plannedUnits);
  const doneUnits = Number(job.stats.unitsGood);
  const unitBased = baseline.basis === 'units';
  const delta = result.projectedProfitCents - baseline.projectedProfitCents;
  // One decimal, the same rounding as every other pace on the page, so the slider starts on the pace the cards show.
  const paceStep = 0.1;
  const priceStep = basePrice !== null && basePrice >= 5 ? 0.05 : 0.01;
  const unitStep = baseUnits >= 5000 ? 100 : baseUnits >= 500 ? 10 : 1;

  return (
    <Panel
      title={title}
      action={
        <div className="flex items-center gap-1">
          <Explain
            title="Profit at finish"
            rule="What happened so far, plus the rest of the job at the pace and cost shown. Labor to come is the units left over the pace, times the cost of an hour. Material, time not on a job and extra services grow with the units left."
            rows={[
              { label: 'Revenue at finish', value: formatMoney(result.revenueAtFinishCents) },
              { label: 'Cost so far', value: formatMoney(result.costSoFarCents), kind: 'minus' },
              {
                label: `Labor to come, ${formatHours(result.hoursLeft ?? 0, { style: 'unit' })}`,
                value: formatMoney(result.laborLeftCents),
                kind: 'minus',
              },
              { label: 'Material to come', value: formatMoney(result.materialLeftCents), kind: 'minus' },
              {
                label: 'Time not on a job to come',
                value: formatMoney(result.sharedLeftCents),
                kind: 'minus',
              },
              {
                label: 'Extra services cost to come',
                value: formatMoney(result.serviceCostLeftCents),
                kind: 'minus',
              },
              {
                label: 'Other cost to come',
                value: formatMoney(result.otherLeftCents),
                kind: 'minus',
              },
              { label: 'Profit at finish', value: formatMoney(result.projectedProfitCents), kind: 'total' },
            ]}
            footnote={
              changed ? 'These numbers use your sliders, not the saved projection.' : projectionNote(baseline)
            }
          />
          {changed ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<RotateCcw aria-hidden />}
              onClick={() => setSliders(NONE)}
              data-testid="whatif-reset"
            >
              Reset
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]" data-testid="whatif">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-secondary">
            {changed ? 'What if the rest of the job ran like this?' : projectionNote(baseline)} Drag a slider
            to test a change. Nothing is saved.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {unitBased && basePace !== null && basePace > 0 ? (
              <Slider
                label="Pace for the rest of the job"
                hint={`${unit} per person per hour`}
                testId="whatif-pace"
                value={sliders.pace ?? round(basePace, paceStep)}
                base={round(basePace, paceStep)}
                min={round(basePace * 0.5, paceStep)}
                max={round(basePace * 1.5, paceStep)}
                step={paceStep}
                onChange={(value) =>
                  setSliders((current) => ({
                    ...current,
                    pace: value === round(basePace, paceStep) ? null : value,
                  }))
                }
                format={(value) => formatPace(value)}
              />
            ) : null}
            {baseRate !== null && baseRate > 0 ? (
              <Slider
                label="Real cost of an hour"
                hint="for the hours still to come"
                testId="whatif-rate"
                value={sliders.rateCents ?? round(baseRate, 25)}
                base={round(baseRate, 25)}
                min={round(baseRate * 0.7, 25)}
                max={round(baseRate * 1.3, 25)}
                step={25}
                onChange={(value) =>
                  setSliders((current) => ({
                    ...current,
                    rateCents: value === round(baseRate, 25) ? null : value,
                  }))
                }
                format={(value) => formatMoneyPerHour(value)}
              />
            ) : null}
            {basePrice !== null && basePrice > 0 ? (
              <Slider
                label={`Price for one ${unit}`}
                hint="for the units still to come"
                testId="whatif-price"
                value={sliders.price ?? round(basePrice, priceStep)}
                base={round(basePrice, priceStep)}
                min={round(basePrice * 0.7, priceStep)}
                max={round(basePrice * 1.5, priceStep)}
                step={priceStep}
                onChange={(value) =>
                  setSliders((current) => ({
                    ...current,
                    price: Math.abs(value - basePrice) < priceStep / 2 ? null : value,
                  }))
                }
                format={(value) => formatUnitPrice(value.toFixed(4))}
              />
            ) : null}
            {unitBased && baseUnits > 0 ? (
              <Slider
                label={`Total ${job.unitLabel} on the job`}
                hint="if the order grows or shrinks"
                testId="whatif-units"
                value={sliders.units ?? baseUnits}
                base={baseUnits}
                min={Math.max(round(Math.max(doneUnits, baseUnits * 0.5), unitStep), unitStep)}
                max={round(baseUnits * 1.5, unitStep)}
                step={unitStep}
                onChange={(value) =>
                  setSliders((current) => ({ ...current, units: value === baseUnits ? null : value }))
                }
                format={(value) => formatNumber(value, { maxDigits: 0 })}
              />
            ) : null}
          </div>
        </div>
        <div
          className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-sunken p-4"
          aria-live="polite"
        >
          <div>
            <p className="text-xs text-fg-muted">
              {changed ? 'Profit at finish, with your changes' : 'Profit at finish, as it runs now'}
            </p>
            <p
              className={cn(
                'text-xl font-semibold tracking-tight tabular-nums',
                result.projectedProfitCents < BigInt(0) ? 'text-danger-text' : 'text-fg',
              )}
              data-testid="whatif-profit"
            >
              {formatMoney(result.projectedProfitCents, { cents: false })}
            </p>
            {changed ? (
              <p
                className={cn(
                  'mt-0.5 text-sm font-medium tabular-nums',
                  delta > BigInt(0)
                    ? 'text-success-text'
                    : delta < BigInt(0)
                      ? 'text-danger-text'
                      : 'text-fg-secondary',
                )}
                data-testid="whatif-delta"
              >
                {formatMoneyDelta(delta, { cents: false })} against{' '}
                {formatMoney(baseline.projectedProfitCents, { cents: false })} now
              </p>
            ) : null}
          </div>
          <dl className="flex flex-col gap-1.5 text-sm tabular-nums">
            <Row
              label="Margin at finish"
              value={formatPercentBp(result.projectedMarginBp, { empty: 'No revenue' })}
              was={changed ? formatPercentBp(baseline.projectedMarginBp, { empty: 'No revenue' }) : undefined}
            />
            <Row
              label="Revenue at finish"
              value={formatMoney(result.revenueAtFinishCents, { cents: false })}
              was={changed ? formatMoney(baseline.revenueAtFinishCents, { cents: false }) : undefined}
            />
            <Row
              label="Cost at finish"
              value={formatMoney(result.costAtFinishCents, { cents: false })}
              was={changed ? formatMoney(baseline.costAtFinishCents, { cents: false }) : undefined}
            />
            <Row
              label="Labor hours at finish"
              value={formatHours(result.projectedLaborHours, { maxDigits: 0 })}
              was={changed ? formatHours(baseline.projectedLaborHours, { maxDigits: 0 }) : undefined}
            />
            <Row
              label="Finish date"
              value={result.projectedFinishDate ? shortDate(result.projectedFinishDate) : 'Not known yet'}
              was={
                changed && baseline.projectedFinishDate ? shortDate(baseline.projectedFinishDate) : undefined
              }
            />
          </dl>
          {job.dueDate && result.projectedFinishDate && result.projectedFinishDate > job.dueDate ? (
            <p className="text-xs text-danger-text">That is after the due date, {shortDate(job.dueDate)}.</p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function Row({
  label,
  value,
  was,
}: {
  readonly label: string;
  readonly value: string;
  readonly was?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="text-right font-medium text-fg">
        {value}
        {was !== undefined && was !== value ? (
          <span className="ml-1.5 text-xs font-normal text-fg-muted">was {was}</span>
        ) : null}
      </dd>
    </div>
  );
}
