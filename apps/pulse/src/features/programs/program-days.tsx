'use client';
/**
 * Days (spec 7.3, tab 4): the month by work day with planned, built, scrap, hours, units per
 * hour, revenue, cost and profit. A day with kits and no hours is flagged with "Add hours", which
 * opens the daily log for that day, prefilled for the program job.
 */
import Link from 'next/link';
import { Clock3 } from 'lucide-react';
import { DashSection, DashboardFrame, EmptyNote, Pill } from '@kitstak/ui/dashboard';
import { BarChart } from '@/components/charts/cartesian';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/cn';
import { formatPace } from '@/lib/format';
import type { ProgramDaysDTO } from '@/lib/program-types';
import { LoadError } from '@/features/profit/profit-ui';
import { capitalize, dayLabel, monthLabel, sumMoney, sumQuantities } from './program-format';
import { Money, SectionSkeleton, hoursText, units } from './program-ui';
import { useProgramDays } from './use-programs';

export function ProgramDays({ programKey, month, initial }: { readonly programKey: string; readonly month: string; readonly currentMonth: string; readonly initial?: ProgramDaysDTO }) {
  const query = useProgramDays(programKey, month, { initialData: initial && initial.month.month === month ? initial : undefined });
  const data = query.data;
  if (query.isError && !data) return <LoadError what="the days" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />;
  if (!data) return <div className="rounded-xl border border-border-subtle bg-panel"><SectionSkeleton label="Loading the days" rows={12} /></div>;
  const money = !data.moneyHidden;
  const unit = data.header.unit;
  const days = data.days;
  const missing = days.filter((day) => day.missingHours);
  const workDays = days.filter((day) => day.workDay || Number(day.units) !== 0);
  const totals = {
    planned: sumQuantities(days.map((day) => day.plannedUnits)),
    built: sumQuantities(days.map((day) => day.units)),
    scrap: sumQuantities(days.map((day) => day.scrap)),
    hours: sumQuantities(days.map((day) => day.hours)),
    revenue: sumMoney(days.map((day) => day.revenueCents)),
    cost: sumMoney(days.map((day) => day.costCents)),
    profit: sumMoney(days.map((day) => day.profitCents)),
  };
  const pace = Number(totals.hours) > 0 ? (Number(totals.built) / Number(totals.hours)).toFixed(3) : null;

  return (
    <DashboardFrame app="pulse" data-testid="program-days">
      {missing.length > 0 ? (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border-subtle bg-panel px-4 py-3 text-sm shadow-xs" data-testid="days-missing-hours">
          <Clock3 aria-hidden className="size-4 shrink-0 text-warning-text" />
          <span className="font-medium text-fg">
            {missing.length === 1 ? `1 day has ${unit.plural} but no hours.` : `${missing.length} days have ${unit.plural} but no hours.`}
          </span>
          <span className="text-fg-secondary">Until the hours are in, cost and margin for those days are too low.</span>
        </div>
      ) : null}
      {workDays.length > 0 ? (
        <div className="max-sm:hidden">
        <DashSection title={`${capitalize(unit.plural)} by day`} description="Built against planned for each work day" data-testid="program-days-chart">
          <BarChart
            title={`${capitalize(unit.plural)} built and planned by day, ${monthLabel(data.month.month)}`}
            description="Each pair of bars is one day: planned, then built."
            labels={workDays.map((day) => dayLabel(day.date).replace(/^\w+, /, ''))}
            format="number"
            height={200}
            series={[
              { id: 'planned', label: 'Planned', values: workDays.map((day) => Number(day.plannedUnits)), color: 'var(--pulse-chart-neutral)' },
              { id: 'built', label: 'Built', values: workDays.map((day) => (day.date > data.month.asOf ? null : Number(day.units))), color: 'var(--pulse-series-1)' },
            ]}
            tableToggle
          />
        </DashSection>
        </div>
      ) : null}
      <DashSection title="Days" description={`${monthLabel(data.month.month)}, every work day and any day off with work or fees`} flush className={cn(query.isFetching && query.isPlaceholderData && 'opacity-60')}>
        {days.length === 0 ? (
          <EmptyNote action={null}>No work days in this month yet. Days show up once the program calendar in Projects has them.</EmptyNote>
        ) : (
          <>
          {/* Phones: one line per day with what matters, and the fix when hours are missing. */}
          <ul className="divide-y divide-border-subtle md:hidden" aria-label="Days" data-testid="day-cards">
            {days.map((day) => {
              const ahead = day.date > data.month.asOf;
              return (
                <li key={day.date} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className={cn('font-medium', day.workDay ? 'text-fg' : 'text-fg-muted')}>{dayLabel(day.date)}</p>
                    <p className="text-xs text-fg-muted tabular-nums">
                      {!day.workDay ? 'Day off' : ahead ? `${units(day.plannedUnits)} planned` : `${units(day.units)} of ${units(day.plannedUnits)} ${unit.plural}${Number(day.hours) > 0 ? `, ${hoursText(day.hours)} hours` : ''}`}
                    </p>
                  </div>
                  {day.missingHours && day.addHoursPath ? (
                    <Link href={day.addHoursPath} className="shrink-0 rounded-sm text-sm font-medium text-fg-link underline-offset-2 hover:underline">
                      Add hours
                    </Link>
                  ) : money && (day.revenueCents || day.costCents) ? (
                    <span className="shrink-0 text-right font-medium tabular-nums">
                      <Money cents={day.profitCents} />
                      <span className="block text-xs font-normal text-fg-muted">profit</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
          <Table aria-label="Days" className="min-w-[960px]">
            <TableHead>
              <tr>
                <TableHeaderCell className="pl-4">Day</TableHeaderCell>
                <TableHeaderCell numeric>Planned</TableHeaderCell>
                <TableHeaderCell numeric>Built</TableHeaderCell>
                <TableHeaderCell numeric>Scrap</TableHeaderCell>
                <TableHeaderCell numeric>Hours</TableHeaderCell>
                <TableHeaderCell numeric>Per hour</TableHeaderCell>
                {money ? (
                  <>
                    <TableHeaderCell numeric>Revenue</TableHeaderCell>
                    <TableHeaderCell numeric>Cost</TableHeaderCell>
                    <TableHeaderCell numeric>Profit</TableHeaderCell>
                  </>
                ) : null}
                <TableHeaderCell className="pr-4"><span className="sr-only">Fix</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {days.map((day) => {
                // A day still ahead has a plan and nothing else yet.
                const ahead = day.date > data.month.asOf;
                const behind = !ahead && Number(day.plannedUnits) > 0 && Number(day.units) < Number(day.plannedUnits);
                return (
                  <TableRow key={day.date} className={cn('h-10', !day.workDay && 'text-fg-muted')} data-testid="day-row">
                    <TableCell className="pl-4 whitespace-nowrap">
                      <span className={cn(day.workDay ? 'font-medium text-fg' : 'text-fg-muted')}>{dayLabel(day.date)}</span>
                      {!day.workDay ? <span className="ml-2 text-xs text-fg-muted">Day off</span> : ahead ? <span className="ml-2 text-xs text-fg-muted">Planned</span> : null}
                    </TableCell>
                    <TableCell numeric className="text-fg-secondary">{Number(day.plannedUnits) === 0 ? '' : units(day.plannedUnits)}</TableCell>
                    <TableCell numeric className={cn('font-medium', behind && 'text-warning-text')}>{(Number(day.units) === 0 && !day.workDay) || ahead ? '' : units(day.units)}</TableCell>
                    <TableCell numeric className={cn(Number(day.scrap) > 0 ? 'text-warning-text' : 'text-fg-muted')}>{Number(day.scrap) === 0 ? '' : units(day.scrap)}</TableCell>
                    <TableCell numeric className="text-fg-secondary">{day.missingHours ? <Pill tone="caution">No hours</Pill> : Number(day.hours) === 0 ? '' : hoursText(day.hours)}</TableCell>
                    <TableCell numeric className="text-fg-secondary">{formatPace(day.unitsPerHour)}</TableCell>
                    {money ? (
                      <>
                        <TableCell numeric className="whitespace-nowrap">{day.revenueCents === 0 ? '' : <Money cents={day.revenueCents} />}</TableCell>
                        <TableCell numeric className="whitespace-nowrap text-fg-secondary">{day.costCents === 0 ? '' : <Money cents={day.costCents} />}</TableCell>
                        <TableCell numeric className="font-medium whitespace-nowrap">{day.revenueCents === 0 && day.costCents === 0 ? '' : <Money cents={day.profitCents} />}</TableCell>
                      </>
                    ) : null}
                    <TableCell className="pr-4 text-right whitespace-nowrap">
                      {day.missingHours && day.addHoursPath ? (
                        <Link href={day.addHoursPath} className="rounded-sm text-sm font-medium text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="day-add-hours">
                          Add hours
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <tfoot>
              <tr className="h-11 border-t-2 border-border-strong bg-sunken font-semibold" data-testid="days-total">
                <TableCell className="pl-4">Total</TableCell>
                <TableCell numeric>{units(totals.planned)}</TableCell>
                <TableCell numeric>{units(totals.built)}</TableCell>
                <TableCell numeric>{units(totals.scrap)}</TableCell>
                <TableCell numeric>{hoursText(totals.hours)}</TableCell>
                <TableCell numeric>{formatPace(pace)}</TableCell>
                {money ? (
                  <>
                    <TableCell numeric className="whitespace-nowrap"><Money cents={totals.revenue} /></TableCell>
                    <TableCell numeric className="whitespace-nowrap"><Money cents={totals.cost} /></TableCell>
                    <TableCell numeric className="whitespace-nowrap"><Money cents={totals.profit} /></TableCell>
                  </>
                ) : null}
                <TableCell className="pr-4" />
              </tr>
            </tfoot>
          </Table>
          </div>
          </>
        )}
      </DashSection>
    </DashboardFrame>
  );
}
