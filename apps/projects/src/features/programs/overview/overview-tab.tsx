'use client';
/**
 * Program Overview (docs/programs/SPEC.md 5.6): answers "are we OK today and this month" first.
 * Alerts strip, setup checklist, KPI row, the month chart, By variant, All linked work and
 * Updates on the left; Today's run, Price card, Statement, Pulse and Details on the right. Every
 * number is read from `/summary` (the same engine cents as the statement and Pulse).
 */
import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, BadgeInfo, CheckCircle2, ChevronLeft, ChevronRight, Circle, OctagonAlert, Target, X } from 'lucide-react';
import { formatCents, formatPercentBp, lastDayOfMonth, ratioBp, shiftMonth, monthOf, unitLabel, workDaysInMonth } from '@kitstak/programs-engine';
import { Badge, Button, IconButton, Popover, PopoverContent, PopoverTrigger, Skeleton, ToggleGroup, cn } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { useProgramSummary } from '@/lib/hooks/use-programs';
import { routes } from '@/lib/routes';
import type { IsoMonth, ProgramSummaryDTO } from '@/lib/program-types';
import { LineChart, type LineSeries } from '@/features/dashboards/charts';
import { useCurrentProgram } from '../program-context';
import { MoneyHiddenNote } from '../kit/chips';
import { useHydrated } from '../kit/use-hydrated';
import { targetTone } from '../kit/format';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { useProgramOverlays } from '../overlays/overlay-params';
import { alertViews, compareWithLastMonth, finishedDaysAverage, minimumKpi, minimumReason, monthChart, monthLong, type AlertView, type ChartMetric } from './overview-model';
import { ByVariantPanel } from './by-variant-panel';
import { DailyColumns } from './daily-columns';
import { DetailsTabsPanel, LinkedWorkPanel, PriceCardPanel, PulsePanel, StatementPanel, TodayRunPanel, UpdatesPanel } from './overview-panels';
import { StatementHiddenSheet, StatementSheet } from '../statement/statement-sheet';
import { CloseSheet } from '../close/close-sheet';

const DISMISS_KEY = (key: string) => `ks-programs:setup-dismissed:${key}`;

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY(key)) === '1';
  } catch {
    return false;
  }
}

const ALERT_ICON = { danger: OctagonAlert, warning: AlertTriangle, info: BadgeInfo } as const;
const ALERT_TONE = {
  danger: 'border-danger/30 bg-danger-subtle/50 text-danger-text',
  warning: 'border-warning/40 bg-warning-subtle/50 text-warning-text',
  info: 'border-info/30 bg-info-subtle/50 text-info-text',
} as const;

function AlertCard({ alert, onAction }: { readonly alert: AlertView; readonly onAction: (alert: AlertView) => void }) {
  const Icon = ALERT_ICON[alert.tone];
  return (
    <li className={cn('flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2', ALERT_TONE[alert.tone])} data-testid="program-alert" data-kind={alert.kind}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 text-sm font-medium text-fg">{alert.text}</span>
      <Button size="sm" variant="secondary" onClick={() => onAction(alert)} className="shrink-0">
        {alert.actionLabel}
      </Button>
    </li>
  );
}

function AlertsStrip({ alerts, onAction }: { readonly alerts: readonly AlertView[]; readonly onAction: (alert: AlertView) => void }) {
  if (alerts.length === 0) return null;
  const shown = alerts.slice(0, 3);
  const rest = alerts.slice(3);
  return (
    <section aria-label="Alerts" className="flex flex-col gap-2 lg:col-span-2">
      <ul className={cn('grid gap-2', shown.length === 1 ? 'grid-cols-1' : shown.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3')}>
        {shown.map((alert) => (
          <AlertCard key={alert.id} alert={alert} onAction={onAction} />
        ))}
      </ul>
      {rest.length ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="self-start">
              See all {alerts.length}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(92vw,420px)] p-2">
            <ul className="flex flex-col gap-2">
              {rest.map((alert) => (
                <AlertCard key={alert.id} alert={alert} onAction={onAction} />
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </section>
  );
}

function SetupChecklist() {
  const { program, capabilities, key } = useCurrentProgram();
  const router = useRouter();
  const hydrated = useHydrated();
  const [dismissedNow, setDismissed] = useState(false);
  const dismissed = dismissedNow || (hydrated && readDismissed(key));
  const rows = [
    { id: 'variants', done: program.setup.hasVariants, label: 'Add variants', action: 'Add variants', href: `${routes.programTab(key, 'variants')}?add=1` },
    { id: 'card', done: program.setup.hasPriceCard, label: 'Add a price card', action: 'Add a price card', href: `${routes.programTab(key, 'price-card')}?new=1`, hidden: !capabilities.canPropose },
    { id: 'schedule', done: program.setup.hasSchedule, label: 'Add a schedule', action: 'Add a schedule', href: `${routes.programTab(key, 'schedule')}?new=1`, hidden: !capabilities.canPlan },
    ...(program.setup.hasPulseJob === null ? [] : [{ id: 'pulse', done: program.setup.hasPulseJob, label: 'Link a Pulse job', action: 'Link job', href: `${routes.programTab(key, 'linked')}?link=pulse`, hidden: !capabilities.canManage }]),
  ].filter((row) => !row.hidden);
  const left = rows.filter((row) => !row.done).length;
  if (dismissed || rows.length === 0 || (left === 0 && rows.every((row) => row.done))) return null;
  return (
    <Panel
      className="lg:col-span-2"
      title={`Finish setting up ${key}`}
      action={
        <IconButton
          label="Hide the setup list"
          variant="ghost"
          size="sm"
          icon={<X aria-hidden />}
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem(DISMISS_KEY(key), '1');
            } catch {
              // Private windows refuse storage; the list hides for this visit only.
            }
          }}
        />
      }
      bodyClassName="p-2"
    >
      <p className="px-2 pb-2 text-xs text-fg-muted">{left === 1 ? '1 step left.' : `${left} steps left.`} Each one makes the numbers on this page more useful.</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
            {row.done ? <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success-text" /> : <Circle aria-hidden className="size-4 shrink-0 text-icon" />}
            <span className={cn('min-w-0 flex-1 text-sm', row.done ? 'text-fg-muted line-through' : 'text-fg')}>{row.label}</span>
            {row.done ? null : (
              <Button size="sm" variant="secondary" onClick={() => router.push(row.href)}>
                {row.action}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Kpi({ label, value, line, lineTone = 'muted', extra, testId }: { readonly label: string; readonly value: React.ReactNode; readonly line?: React.ReactNode; readonly lineTone?: 'muted' | 'success' | 'danger' | 'warning' | 'neutral'; readonly extra?: React.ReactNode; readonly testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3" data-testid={testId}>
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <span className="text-[clamp(1.125rem,1.5vw,1.5rem)] leading-tight font-semibold tracking-tight whitespace-nowrap text-fg tabular-nums">{value}</span>
      {extra}
      {line ? (
        <span className={cn('text-xs', lineTone === 'success' ? 'text-success-text' : lineTone === 'danger' ? 'text-danger-text' : lineTone === 'warning' ? 'text-warning-text' : lineTone === 'neutral' ? 'text-fg-secondary' : 'text-fg-muted')}>{line}</span>
      ) : null}
    </div>
  );
}

function HowWeGotThis({ summary }: { readonly summary: ProgramSummaryDTO }) {
  const { forecast, result } = summary;
  const { unit } = useCurrentProgram();
  const rows: [string, string][] = [
    ['So far this month', formatCents(forecast.actualCents, { cents: true })],
    ['Work days left', String(forecast.remainingWorkDays)],
    ['Average work charges a day', formatCents(forecast.avgDailyWorkCents, { cents: true })],
    ['From planned builds', formatCents(forecast.plannedCents, { cents: true })],
    ['From recent days', formatCents(forecast.recentCents, { cents: true })],
    ['Fixed and one time so far', formatCents(result.fixed?.totalCents ?? '0', { cents: true })],
  ];
  if (result.minimum && result.minimum.status !== 'none') rows.push(['Monthly minimum', formatCents(result.minimum.minimumCents, { cents: true })]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex w-fit items-center gap-1 rounded-sm text-left text-xs font-medium text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus" data-testid="forecast-basis">
          {forecast.methodText}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,320px)] p-0">
        <div className="border-b border-border-subtle px-4 py-3">
          <p className="text-sm font-semibold text-fg">How we got this</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {forecast.method === 'planned' ? `What is built so far, plus the ${unit.plural} on planned builds for the rest of the month at today's prices.` : 'What is built so far, plus the average of recent work days for each work day left.'}
          </p>
        </div>
        <dl className="flex flex-col gap-1.5 px-4 py-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="font-medium text-fg tabular-nums">{value}</dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-border-subtle pt-2">
            <dt className="font-medium text-fg">Forecast</dt>
            <dd className="font-semibold text-fg tabular-nums">{formatCents(forecast.forecastCents, { cents: true })}</dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function KpiRow({ summary, lastMonth, lastMonthLoading }: { readonly summary: ProgramSummaryDTO; readonly lastMonth: ProgramSummaryDTO | undefined; readonly lastMonthLoading: boolean }) {
  const { unit, program, moneyHidden, capabilities } = useCurrentProgram();
  const avg = finishedDaysAverage(summary.byDay, summary.asOf);
  const grid = 'grid grid-cols-2 divide-border-subtle rounded-xl border border-border-subtle bg-panel shadow-xs md:grid-cols-4 [&>*]:border-border-subtle max-md:[&>*:nth-child(-n+2)]:border-b md:divide-x max-md:[&>*:nth-child(odd)]:border-r';
  if (moneyHidden) {
    const today = summary.today;
    const daily = program.settings.dailyTargetUnits;
    const pct = daily && Number(daily) > 0 ? Math.floor((Number(today.builtUnits) / Number(daily)) * 100) : null;
    return (
      <section aria-label="This month" id="month" className={grid} data-testid="program-kpis-units">
        <Kpi label="Built this month" value={unitLabel(summary.result.units, unit)} line={avg} />
        <Kpi label="Builds done today" value={`${today.done} of ${today.builds}`} line={today.builds ? `${today.builds - today.done} still open` : 'No builds today'} />
        <Kpi label="Today" value={unitLabel(today.builtUnits, unit)} line={`of ${unitLabel(today.plannedUnits, unit)} planned`} />
        <Kpi label="Of daily target" value={pct === null ? 'Not set' : `${pct}%`} line={daily ? `Target ${unitLabel(daily, unit)} a day` : capabilities.canEdit ? 'Set a daily target in Settings' : 'No daily target yet'} />
      </section>
    );
  }
  const compare = compareWithLastMonth(summary.byDay, lastMonth?.byDay, summary.asOf);
  const cardMinimum = program.currentVersion?.lines.find((line) => line.kind === 'monthly_minimum')?.amountCents ?? null;
  const minimum = minimumKpi(summary.result, summary.forecast, { cardMinimumCents: cardMinimum, month: monthOf(summary.asOf), startDate: program.startDate, endDate: program.endDate });
  const target = program.month.targetCents;
  // The forecast can include a projected minimum top up. The target badge grades the work alone,
  // so a program that meets its target only through the top up never shows a green 100%.
  const topUp = summary.forecast.projectedGapCents && summary.result.minimum && summary.result.minimum.status !== 'none' ? BigInt(summary.forecast.projectedGapCents) : BigInt(0);
  const workForecast = summary.forecast.forecastCents !== null ? BigInt(summary.forecast.forecastCents) - topUp : null;
  const targetBp = summary.forecast.targetBp === null || !target ? null : topUp > BigInt(0) && workForecast !== null ? ratioBp(workForecast, target) : summary.forecast.targetBp;
  const revenueLine = compare ? compare.text : lastMonthLoading ? <Skeleton height={14} width={180} rounded="sm" /> : 'First month with revenue';
  return (
    <section aria-label="This month" id="month" className={grid} data-testid="program-kpis-money">
      <Kpi testId="kpi-revenue" label="Revenue this month" value={formatCents(summary.result.totalCents, { cents: true })} line={revenueLine} lineTone={compare?.tone === 'neutral' ? 'muted' : compare?.tone ?? 'muted'} />
      <Kpi testId="kpi-built" label="Built this month" value={unitLabel(summary.result.units, unit)} line={avg} />
      <Kpi
        testId="kpi-forecast"
        label="Forecast"
        value={formatCents(summary.forecast.forecastCents, { cents: true })}
        extra={
          <div className="flex flex-wrap items-center gap-1.5">
            {targetBp !== null && target ? (
              <Badge tone={topUp > BigInt(0) ? 'warning' : targetTone(targetBp)} icon={<Target aria-hidden />}>
                {`${formatPercentBp(targetBp)} of ${formatCents(target)} target`}
              </Badge>
            ) : null}
            <HowWeGotThis summary={summary} />
          </div>
        }
        line={topUp > BigInt(0) ? `Includes a ${formatCents(topUp, { cents: true })} minimum top up` : undefined}
        lineTone="warning"
      />
      <Kpi testId="kpi-minimum" label="Minimum" value={<span className={cn('whitespace-normal', minimum.tone === 'success' && 'text-success-text', minimum.tone === 'warning' && 'text-warning-text', minimum.tone === 'muted' && 'text-fg-muted', minimum.value.length > 12 && 'text-base')}>{minimum.value}</span>} line={
          minimum.reason ? (
            <>
              {minimum.line}
              <span className="mt-0.5 block text-fg-muted" data-testid="kpi-minimum-reason">
                {minimum.reason}
              </span>
            </>
          ) : (
            minimum.line
          )
        }
        lineTone={minimum.tone === 'neutral' ? 'neutral' : 'muted'}
      />
    </section>
  );
}

function MonthChartPanel({ month, onMonth, summary, loading }: { readonly month: IsoMonth; readonly onMonth: (month: IsoMonth) => void; readonly summary: ProgramSummaryDTO | undefined; readonly loading: boolean }) {
  const { program, unit, moneyHidden, today } = useCurrentProgram();
  const [metric, setMetric] = useState<ChartMetric>(moneyHidden ? 'units' : 'revenue');
  const shownMetric: ChartMetric = moneyHidden ? 'units' : metric;
  const current = monthOf(today);
  const startMonth = program.startDate ? monthOf(program.startDate) : null;
  const calendar = useMemo(
    () => ({ timezone: program.calendar.timezone, workingDays: program.calendar.workingDays, daysOff: program.calendar.daysOff, extraWorkDays: program.calendar.extraWorkDays, activeFrom: program.calendar.activeFrom, activeTo: program.calendar.activeTo, paused: program.calendar.paused }),
    [program.calendar],
  );
  const data = useMemo(() => {
    if (!summary) return null;
    const workDays = workDaysInMonth(calendar as Parameters<typeof workDaysInMonth>[0], month).length;
    return monthChart({
      month,
      asOf: summary.asOf,
      byDay: summary.byDay,
      metric: shownMetric,
      forecastCents: summary.forecast.forecastCents,
      targetCents: program.settings.monthlyTargetCents,
      minimumCents: summary.result.minimum && summary.result.minimum.status !== 'none' ? summary.result.minimum.minimumCents : null,
      dailyTargetUnits: program.settings.dailyTargetUnits,
      workDays,
    });
  }, [summary, month, shownMetric, program.settings.monthlyTargetCents, program.settings.dailyTargetUnits, calendar]);
  const series: LineSeries[] = data
    ? [
        { id: 'actual', label: shownMetric === 'revenue' ? 'Revenue so far' : `${unit.plural[0]?.toUpperCase()}${unit.plural.slice(1)} built`, color: 'var(--chart-1)', values: data.actual, area: true },
        ...(data.forecast.some((value) => value !== null) ? [{ id: 'forecast', label: summary?.forecast.methodText ?? 'Forecast', color: 'var(--chart-1)', values: data.forecast, dashed: true }] : []),
        ...(data.target ? [{ id: 'target', label: 'Target', color: 'var(--warning)', values: data.target, dashed: true }] : []),
      ]
    : [];
  const partMonth = Boolean(summary?.result.minimum && minimumReason(summary.result.minimum.minimumCents, program.currentVersion?.lines.find((line) => line.kind === 'monthly_minimum')?.amountCents ?? null, month, program.startDate, program.endDate));
  const references = data?.minimum ? [{ id: 'minimum', label: partMonth ? 'Minimum this month' : 'Minimum', value: data.minimum[0] ?? 0, color: 'var(--danger)', dashed: true }] : [];
  const money = (value: number) => formatCents(Math.round(value * 100));
  const qty = (value: number) => `${Math.round(value).toLocaleString('en-US')}`;
  return (
    <Panel
      title={<span className="whitespace-nowrap">This month</span>}
      action={
        <span className="flex items-center rounded-md border border-border-subtle">
          <IconButton label="Previous month" variant="ghost" size="sm" icon={<ChevronLeft aria-hidden />} disabled={Boolean(startMonth && month <= startMonth)} onClick={() => onMonth(shiftMonth(month, -1))} />
          <span className="min-w-[78px] text-center text-xs font-medium text-fg-secondary tabular-nums" data-testid="chart-month">
            {monthLong(month).replace(/^(\w{3})\w*/, '$1')}
          </span>
          <IconButton label="Next month" variant="ghost" size="sm" icon={<ChevronRight aria-hidden />} disabled={month >= current} onClick={() => onMonth(shiftMonth(month, 1))} />
        </span>
      }
    >
      {loading || !data ? (
        <Skeleton height={260} rounded="md" />
      ) : (
        <div className="flex flex-col gap-4">
          {moneyHidden ? null : (
            <div className="-mb-2 flex justify-end">
              <ToggleGroup label="Chart shows" size="sm" value={metric} onValueChange={(value) => setMetric(value as ChartMetric)} options={[{ value: 'revenue', label: 'Revenue' }, { value: 'units', label: 'Units' }]} />
            </div>
          )}
          <LineChart
            title={shownMetric === 'revenue' ? `Revenue for ${monthLong(month)}, cumulative` : `${unit.plural} built in ${monthLong(month)}, cumulative`}
            series={series}
            labels={data.labels}
            formatLabel={(label) => label.slice(8, 10).replace(/^0/, '')}
            markerIndex={data.todayIndex}
            references={references}
            formatValue={shownMetric === 'revenue' ? money : qty}
            height={240}
          />
          <DailyColumns days={data.daily} unit={unit} moneyHidden={moneyHidden} />
        </div>
      )}
    </Panel>
  );
}

export interface OverviewTabProps {
  readonly initialSummary: ProgramSummaryDTO;
  readonly updateDraft: string;
  readonly loadedAt: number;
}

export function OverviewTab({ initialSummary, updateDraft, loadedAt }: OverviewTabProps) {
  const { key, program, unit, today, capabilities, moneyHidden, variantById } = useCurrentProgram();
  const router = useRouter();
  const params = useSearchParams();
  const overlays = useProgramOverlays();
  const drawer = useTaskDrawer();
  const thisMonth = initialSummary.month;
  const [month, setMonth] = useState<IsoMonth>(thisMonth);
  const summaryQuery = useProgramSummary(key, thisMonth, { initialData: initialSummary, initialDataUpdatedAt: loadedAt });
  const summary = summaryQuery.data ?? initialSummary;
  const chartQuery = useProgramSummary(key, month, { enabled: month !== thisMonth });
  const chartSummary = month === thisMonth ? summary : chartQuery.data;
  const lastMonthStart = shiftMonth(thisMonth, -1);
  const lastMonthQuery = useProgramSummary(key, lastMonthStart, { enabled: !moneyHidden && Boolean(program.startDate && program.startDate <= lastDayOfMonth(lastMonthStart)) });
  const alerts = useMemo(
    () =>
      alertViews(summary.alerts, {
        unit,
        programKey: key,
        today,
        seesSync: capabilities.seesSync,
        variantName: (id) => variantById.get(id)?.name ?? null,
        pulseJobNumber: summary.pulse?.job?.number ?? null,
        gapMinutes: summary.pulse?.pendingSince ? Math.floor((loadedAt - Date.parse(summary.pulse.pendingSince)) / 60_000) : null,
      }),
    [summary, unit, key, today, capabilities.seesSync, variantById, loadedAt],
  );
  const statementMonth = params?.get('statement');
  const closeMonth = params?.get('close');
  const onAlert = (alert: AlertView) => {
    switch (alert.action.kind) {
      case 'log':
        overlays.openLog({ date: alert.action.date || today });
        return;
      case 'forecast':
        document.getElementById('month')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      case 'price-card':
        router.push(routes.programTab(key, 'price-card'));
        return;
      case 'new-card':
        router.push(`${routes.programTab(key, 'price-card')}?new=1`);
        return;
      case 'variants':
        router.push(routes.programTab(key, 'variants'));
        return;
      case 'build':
        drawer.openTask(alert.action.buildKey);
        return;
      case 'linked':
        router.push(routes.programTab(key, 'linked'));
    }
  };
  const showLinkedWork = !moneyHidden && Boolean(summary.linkedWork && summary.linkedWork.relatedJobs.length > 0);
  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-[1.65fr_1fr]" data-testid="program-overview">
      <AlertsStrip alerts={alerts} onAction={onAlert} />
      <SetupChecklist />
      <div className="flex min-w-0 flex-col gap-4">
        <KpiRow summary={summary} lastMonth={lastMonthQuery.data} lastMonthLoading={lastMonthQuery.isPending && lastMonthQuery.fetchStatus !== 'idle'} />
        {moneyHidden ? <MoneyHiddenNote className="-mt-1 px-1" /> : null}
        <MonthChartPanel month={month} onMonth={setMonth} summary={chartSummary} loading={month !== thisMonth && chartQuery.isLoading} />
        <ByVariantPanel summary={summary} />
        {showLinkedWork && summary.linkedWork ? <LinkedWorkPanel linkedWork={summary.linkedWork} /> : null}
        <UpdatesPanel draft={updateDraft} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <TodayRunPanel today={summary.today} />
        <PriceCardPanel />
        {moneyHidden ? null : <StatementPanel summary={summary} />}
        {summary.pulse && summary.pulse.state !== 'unavailable' && summary.pulse.available ? <PulsePanel parity={summary.pulse} /> : null}
        <DetailsTabsPanel />
      </div>
      {statementMonth && /^\d{4}-\d{2}$/.test(statementMonth) ? moneyHidden ? <StatementHiddenSheet month={statementMonth} /> : <StatementSheet month={statementMonth} /> : null}
      {closeMonth && /^\d{4}-\d{2}$/.test(closeMonth) && capabilities.canClose ? <CloseSheet month={closeMonth} /> : null}
    </div>
  );
}
