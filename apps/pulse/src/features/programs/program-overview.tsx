'use client';
/**
 * The program Overview (spec 7.3, tab 1): the KPI strip (revenue, cost, profit, margin against
 * the customer's target, kits against planned, units per hour), the month forecast, the running
 * revenue and cost chart with the forecast and the monthly target, up to three alerts, and the
 * parity line with Projects.
 */
import Link from 'next/link';
import type { UseQueryResult } from '@tanstack/react-query';
import { CircleCheck, Clock3, TriangleAlert } from 'lucide-react';
import { ActionList, ActionRow, DashSection, DashboardFrame, EmptyNote, Meter, StatRow, StatTile } from '@kitstak/ui/dashboard';
import { LineChart } from '@/components/charts/cartesian';
import { Sparkline } from '@/components/charts/sparkline';
import { cn } from '@/components/ui/cn';
import { formatHours, formatMoney, formatPace, formatPercentBp } from '@/lib/format';
import type { ProgramAlertDTO, ProgramMonthDTO } from '@/lib/program-types';
import { routes, type ProgramTab } from '@/lib/routes';
import { eachDay, firstDayOfMonth, lastDayOfMonth } from '@/lib/profit/calendar';
import { LoadError } from '@/features/profit/profit-ui';
import { capitalize, marginTone, monthLabel, shareOfPlan, sumMoney, toneText } from './program-format';
import { Figure, Margin, units } from './program-ui';

const ALERT_TAB: Readonly<Record<ProgramAlertDTO['action'], ProgramTab | null>> = {
  see_variants: 'variants',
  open_variant: 'variants',
  see_days: 'days',
  add_hours: 'days',
  open_in_projects: null,
};

/** Running revenue and cost per day, the forecast as a straight dashed line from today to month end. */
export function chartSeries(data: ProgramMonthDTO): { dates: string[]; revenue: (number | null)[]; cost: (number | null)[]; forecastRevenue: (number | null)[]; forecastCost: (number | null)[] } {
  const month = data.month.month;
  const dates = eachDay(firstDayOfMonth(month), lastDayOfMonth(month));
  const byDate = new Map(data.chart.map((day) => [day.date, day]));
  const revenue = dates.map((date) => byDate.get(date)?.revenueCents ?? null);
  const cost = dates.map((date) => byDate.get(date)?.costCents ?? null);
  const empty = dates.map(() => null as number | null);
  const last = data.chart[data.chart.length - 1];
  const forecast = data.costForecast;
  if (data.month.when !== 'current' || !last || !forecast || forecast.forecastRevenueCents === null) return { dates, revenue, cost, forecastRevenue: empty, forecastCost: empty };
  const from = dates.indexOf(last.date);
  const to = dates.length - 1;
  const line = (start: number | null, end: number | null): (number | null)[] =>
    dates.map((_, index) => {
      if (start === null || end === null || index < from) return null;
      if (to === from) return end;
      // Drawn on screen only: a straight line between two exact amounts, rounded to the cent.
      return Math.round(start + ((end - start) * (index - from)) / (to - from));
    });
  return { dates, revenue, cost, forecastRevenue: line(last.revenueCents, forecast.forecastRevenueCents), forecastCost: forecast.enoughDays ? line(last.costCents, forecast.forecastCostCents) : empty };
}

function Parity({ data }: { readonly data: ProgramMonthDTO }) {
  const parity = data.parity;
  if (!parity.visible) return null;
  if (parity.status === 'matches') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-fg-secondary" data-testid="program-parity">
        <CircleCheck aria-hidden className="size-4 text-success" />
        Matches Projects to the cent
      </p>
    );
  }
  if (parity.status === 'catching_up') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-fg-secondary" data-testid="program-parity">
        <Clock3 aria-hidden className="size-4 text-icon" />
        Pulse is catching up
      </p>
    );
  }
  if (parity.status === 'off') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-warning-text" data-testid="program-parity">
        <TriangleAlert aria-hidden className="size-4" />
        {parity.diffCents !== null ? `Pulse is ${formatMoney(Math.abs(parity.diffCents))} off from Projects` : 'Pulse and Projects do not match yet'}
      </p>
    );
  }
  return (
    <p className="text-sm text-fg-muted" data-testid="program-parity">
      Projects could not be read, so Pulse cannot check its numbers against it right now.
    </p>
  );
}

export function ProgramOverview({ query, projectsHref }: { readonly query: UseQueryResult<ProgramMonthDTO>; readonly projectsHref: string }) {
  const data = query.data;
  if (query.isError && !data) return <LoadError what="this month" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />;
  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-3" data-testid="program-overview-loading">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span key={index} aria-hidden className="ks-skeleton block h-[112px] rounded-xl" />
        ))}
        <span className="sr-only" role="status">
          Loading this month
        </span>
      </div>
    );
  }
  const { figures, plan, costForecast: forecast, target, header } = data;
  const money = !data.moneyHidden;
  const unit = header.unit;
  const key = header.key;
  const month = data.month.month;
  const targetBp = target.targetMarginBp;
  const planned = plan?.plannedUnits ?? null;
  const cumulative = data.chart;
  const spark = (pick: (day: ProgramMonthDTO['chart'][number]) => number | null) => (cumulative.length > 1 ? <Sparkline values={cumulative.map(pick)} label="Running total this month" width={88} height={28} /> : undefined);
  const series = chartSeries(data);
  const tabHref = (tab: ProgramTab) => routes.program(key, { tab, month });
  const shownAlerts = data.alerts.slice(0, 3);
  const otherCost = sumMoney([figures.materialCents, figures.otherCents, figures.sharedCents]);
  const current = data.month.when === 'current';
  const future = data.month.when === 'future';

  return (
    <DashboardFrame app="pulse" data-testid="program-overview">
      <div className={cn('flex flex-col gap-4 transition-opacity', query.isFetching && query.isPlaceholderData && 'opacity-60')}>
        <StatRow label={`${key} in ${monthLabel(month)}`} data-testid="program-kpis">
          {money ? (
            <>
              <StatTile label="Revenue" href={null} value={formatMoney(figures.revenueCents)} trend={spark((day) => day.revenueCents)} caption={(figures.feeCents ?? 0) !== 0 ? `${formatMoney(figures.workRevenueCents)} work, ${formatMoney(figures.feeCents)} fees` : `${formatMoney(figures.revenuePerUnitCents)} a ${unit.singular}`} data-testid="kpi-revenue" />
              <StatTile label="Cost" href={null} value={formatMoney(figures.costCents)} trend={spark((day) => day.costCents)} caption={`${formatMoney(figures.laborCents)} labor${(otherCost ?? 0) !== 0 ? `, ${formatMoney(otherCost)} other` : ''}`} data-testid="kpi-cost" />
              <StatTile label="Profit" href={null} value={<span className={cn((figures.profitCents ?? 0) < 0 && 'text-danger-text')}>{formatMoney(figures.profitCents)}</span>} caption={figures.profitPerUnitCents !== null ? `${formatMoney(figures.profitPerUnitCents)} a ${unit.singular}` : undefined} data-testid="kpi-profit" />
              <StatTile
                label="Margin"
                href={null}
                value={<span className={toneText(marginTone(figures.marginBp, targetBp))}>{formatPercentBp(figures.marginBp, { empty: 'No revenue yet' })}</span>}
                caption={
                  targetBp !== null ? (
                    <span data-testid="kpi-target">
                      Target {formatPercentBp(targetBp, { digits: 0 })} for this customer
                      {target.clientPath ? (
                        <>
                          {' · '}
                          <Link href={target.clientPath} className="relative z-[1] rounded-sm font-medium text-fg-secondary underline underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="kpi-change-target">
                            Change it on the client
                          </Link>
                        </>
                      ) : null}
                    </span>
                  ) : undefined
                }
                data-testid="kpi-margin"
              />
            </>
          ) : null}
          <StatTile
            label={`${capitalize(unit.plural)} built`}
            href={null}
            value={units(figures.units)}
            trend={spark((day) => Number(day.units))}
            caption={
              planned !== null ? (
                <span className="flex w-full flex-col gap-1.5">
                  <span>
                    of <span className="font-medium text-fg-secondary tabular-nums">{units(planned)}</span> planned, {Math.round(shareOfPlan(figures.units, planned) * 100)}%
                  </span>
                  <Meter value={shareOfPlan(figures.units, planned)} label={`${units(figures.units)} of ${units(planned)} ${unit.plural} planned`} />
                </span>
              ) : (
                'No plan from Projects'
              )
            }
            className="[&_.ks-dash-stat-caption]:w-full"
            data-testid="kpi-units"
          />
          <StatTile label={`${capitalize(unit.plural)} per hour`} href={null} value={formatPace(figures.unitsPerHour, { empty: 'No hours yet' })} caption={`${formatHours(figures.hours)} labor hours${Number(figures.scrap) > 0 ? `, ${units(figures.scrap)} scrap` : ''}`} data-testid="kpi-pace" />
        </StatRow>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
          {money ? (
            <DashSection title="Revenue and cost this month" description={current ? 'Running totals by day, then the forecast to month end' : 'Running totals by day'} footer={<Parity data={data} />} data-testid="program-chart">
              {future ? (
                <EmptyNote action={{ label: 'See the plan by variant', href: tabHref('variants') }}>This month has not started. Its plan from Projects is in By variant.</EmptyNote>
              ) : (
                <LineChart
                  title={`Revenue and cost of ${key}, ${monthLabel(month)}`}
                  description="Solid lines are the running totals so far. Dashed lines are the forecast to month end. The flat line is the monthly target."
                  dates={series.dates}
                  bucket="day"
                  format="money"
                  zeroBased
                  height={320}
                  series={[
                    { id: 'revenue', label: 'Revenue', values: series.revenue, color: 'var(--pulse-series-1)' },
                    { id: 'cost', label: 'Cost', values: series.cost, color: 'var(--pulse-series-2)' },
                    ...(series.forecastRevenue.some((value) => value !== null) ? [{ id: 'forecast-revenue', label: 'Forecast revenue', values: series.forecastRevenue, color: 'var(--pulse-series-1)', dashed: true }] : []),
                    ...(series.forecastCost.some((value) => value !== null) ? [{ id: 'forecast-cost', label: 'Forecast cost', values: series.forecastCost, color: 'var(--pulse-series-2)', dashed: true }] : []),
                  ]}
                  target={plan?.targetCents ? { value: plan.targetCents, label: 'Monthly target' } : undefined}
                  tableToggle
                  emptyTitle="No work this month yet"
                  emptyHint="Builds in Projects and hours in Pulse show up here."
                />
              )}
            </DashSection>
          ) : (
            <DashSection title={`${capitalize(unit.plural)} built this month`} description="Running total by day" footer={<Parity data={data} />} data-testid="program-chart">
              <LineChart title={`${capitalize(unit.plural)} built, ${monthLabel(month)}`} description="The running total of good units by day." dates={series.dates} bucket="day" format="number" zeroBased height={280} series={[{ id: 'units', label: capitalize(unit.plural), values: series.dates.map((date) => { const day = data.chart.find((item) => item.date === date); return day ? Number(day.units) : null; }) }]} emptyTitle="No work this month yet" emptyHint="Builds in Projects show up here." />
            </DashSection>
          )}

          <div className="flex min-w-0 flex-col gap-4">
            {money ? (
              <DashSection title="Month forecast" description={plan ? (plan.forecastMethod === 'planned' ? 'From the planned builds in Projects' : 'From recent days, no builds are planned') : 'Projects could not be read'} data-testid="program-forecast">
                {plan && forecast ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <Figure label="Forecast revenue" value={formatMoney(plan.forecastCents)} note="From Projects" testId="forecast-revenue" />
                    <Figure label="Forecast cost" value={forecast.enoughDays ? formatMoney(forecast.forecastCostCents) : <span className="text-base font-normal text-fg-muted">Not enough days yet.</span>} note={forecast.enoughDays ? `${formatMoney(forecast.costPerUnitCents)} a ${unit.singular}${forecast.basis === 'recent_days' ? ', last 20 work days' : ''}` : undefined} testId="forecast-cost" />
                    <Figure label="Forecast margin" value={forecast.enoughDays ? <Margin marginBp={forecast.forecastMarginBp} targetBp={targetBp} className="font-semibold" /> : <span className="text-base font-normal text-fg-muted">Not enough days yet.</span>} note={targetBp !== null ? `Target ${formatPercentBp(targetBp, { digits: 0 })}` : undefined} testId="forecast-margin" />
                    <Figure label="Forecast profit" value={forecast.enoughDays ? formatMoney(forecast.forecastProfitCents) : <span className="text-base font-normal text-fg-muted">Not enough days yet.</span>} testId="forecast-profit" />
                    {plan.targetCents !== null ? <Figure label="Monthly target" value={formatMoney(plan.targetCents)} note={(plan.forecastCents ?? 0) >= plan.targetCents ? 'Forecast is above it' : 'Forecast is under it'} testId="forecast-target" /> : null}
                    {plan.minimumCents !== null ? <Figure label="Monthly minimum" value={formatMoney(plan.minimumCents)} note={(plan.projectedGapCents ?? 0) > 0 ? <span className="text-warning-text">May miss it by {formatMoney(plan.projectedGapCents)}</span> : 'On pace to meet it'} testId="forecast-minimum" /> : null}
                  </dl>
                ) : (
                  <EmptyNote action={{ label: 'Open in Projects', href: projectsHref }}>The plan comes from Projects, and it could not be read right now. The numbers above are from Pulse.</EmptyNote>
                )}
              </DashSection>
            ) : (
              <DashSection title="Plan from Projects" data-testid="program-forecast">
                <dl className="grid grid-cols-2 gap-4">
                  <Figure label="Planned" value={units(planned)} note={unit.plural} />
                  <Figure label="Built so far" value={units(figures.units)} note={unit.plural} />
                </dl>
              </DashSection>
            )}

            <DashSection title="Alerts" description={data.alerts.length > 3 ? `${data.alerts.length} fired, the first 3 are shown` : undefined} flush data-testid="program-alerts">
              {shownAlerts.length === 0 ? (
                <EmptyNote action={{ label: 'See days', href: tabHref('days') }}>
                  {current ? 'Nothing needs you on this program this month. Pulse checks margin, cost per kit, the minimum, hours and pace each day.' : 'No alerts for this month.'}
                </EmptyNote>
              ) : (
                <ActionList label="Program alerts">
                  {shownAlerts.map((alert) => {
                    const tab = ALERT_TAB[alert.action];
                    return (
                      <ActionRow
                        key={`${alert.rule}-${alert.variantId ?? ''}`}
                        href={tab ? tabHref(tab) : projectsHref}
                        marker={alert.rule === 'P1' || alert.rule === 'P2' || alert.rule === 'P4' || alert.rule === 'P5' ? 'caution' : 'info'}
                        title={<span className="whitespace-normal">{alert.sentence}</span>}
                        cta={alert.actionLabel}
                        shape="value"
                        data-testid="program-alert"
                      />
                    );
                  })}
                </ActionList>
              )}
            </DashSection>
          </div>
        </div>
      </div>
    </DashboardFrame>
  );
}
