'use client';
/**
 * By month (spec 7.3, tab 3): the last 12 months with kits, revenue, cost, profit, margin against
 * the customer's target, the monthly minimum met or missed, and closed or open. A bar chart of
 * revenue and cost sits on top. Clicking a month opens that month on the Overview.
 */
import { DashSection, DashboardFrame, EmptyNote, Pill, type PillTone } from '@kitstak/ui/dashboard';
import { BarChart } from '@/components/charts/cartesian';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/cn';
import { formatPace, formatPercentBp } from '@/lib/format';
import type { ProgramMonthRowDTO, ProgramMonthsDTO } from '@/lib/program-types';
import { routes } from '@/lib/routes';
import { LoadError } from '@/features/profit/profit-ui';
import { capitalize, monthLabel, monthShort } from './program-format';
import { Margin, Money, PlaceLink, SectionSkeleton, hoursText, units } from './program-ui';
import { useProgramMonths } from './use-programs';

const MINIMUM: Readonly<Record<NonNullable<ProgramMonthRowDTO['minimum']>, { label: string; tone: PillTone }>> = {
  met: { label: 'Met', tone: 'positive' },
  missed: { label: 'Missed', tone: 'critical' },
  open: { label: 'Not settled', tone: 'neutral' },
  none: { label: 'No minimum', tone: 'neutral' },
};

export function ProgramMonths({ programKey, currentMonth, initial }: { readonly programKey: string; readonly currentMonth: string; readonly initial?: ProgramMonthsDTO; readonly onOpenMonth?: (month: string) => void }) {
  const query = useProgramMonths(programKey, '', '', { initialData: initial });
  const data = query.data;
  if (query.isError && !data) return <LoadError what="the months" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />;
  if (!data) return <div className="rounded-xl border border-border-subtle bg-panel"><SectionSkeleton label="Loading the months" rows={12} /></div>;
  const money = !data.moneyHidden;
  const unit = data.header.unit;
  // Months before the program started have nothing to show: hide the empty tail, oldest first for the chart.
  const firstActive = [...data.months].reverse().findIndex((row) => Number(row.units) !== 0 || (row.revenueCents ?? 0) !== 0 || Number(row.hours) !== 0);
  const shown = firstActive < 0 ? [] : data.months.slice(0, data.months.length - firstActive);
  // The chart keeps all 12 months, so a new program reads as new instead of as three wide bars.
  const oldestFirst = [...data.months].reverse();
  const quiet = data.months.length - shown.length;
  const href = (month: string) => routes.program(data.header.key, { month: month === currentMonth ? undefined : month });

  return (
    <DashboardFrame app="pulse" data-testid="program-months">
      {shown.length === 0 ? (
        <DashSection title="By month">
          <EmptyNote action={{ label: 'Open the Overview', href: routes.program(data.header.key) }}>No month has work yet. Months show up here once the first build is logged.</EmptyNote>
        </DashSection>
      ) : (
        <>
          <DashSection title={money ? 'Revenue and cost by month' : `${capitalize(unit.plural)} by month`} description={`${monthShort(oldestFirst[0]!.month)} to ${monthShort(oldestFirst[oldestFirst.length - 1]!.month)}`} data-testid="program-months-chart">
            <BarChart
              title={money ? `Revenue and cost of ${data.header.key} by month` : `${capitalize(unit.plural)} built by month`}
              description={money ? 'Each pair of bars is one month: revenue, then cost.' : 'Each bar is one month.'}
              dates={oldestFirst.map((row) => `${row.month}-01`)}
              bucket="month"
              format={money ? 'money' : 'number'}
              height={220}
              series={money ? [{ id: 'revenue', label: 'Revenue', values: oldestFirst.map((row) => (row.revenueCents || row.costCents ? row.revenueCents : null)), color: 'var(--pulse-series-1)' }, { id: 'cost', label: 'Cost', values: oldestFirst.map((row) => (row.revenueCents || row.costCents ? row.costCents : null)), color: 'var(--pulse-series-2)' }] : [{ id: 'units', label: capitalize(unit.plural), values: oldestFirst.map((row) => (Number(row.units) ? Number(row.units) : null)) }]}
              tableToggle
            />
          </DashSection>
          <DashSection title="By month" description="Newest first. Pick a month to open it on the Overview." footer={quiet > 0 ? <span>{quiet === 1 ? '1 earlier month has' : `${quiet} earlier months have`} no work, so {quiet === 1 ? 'it is' : 'they are'} left out of the table.</span> : undefined} flush className={cn(query.isFetching && 'opacity-80')}>
            <Table aria-label="By month" className="min-w-[960px]">
              <TableHead>
                <tr>
                  <TableHeaderCell className="pl-4">Month</TableHeaderCell>
                  <TableHeaderCell numeric>{capitalize(unit.plural)}</TableHeaderCell>
                  <TableHeaderCell numeric>Hours</TableHeaderCell>
                  <TableHeaderCell numeric>Per hour</TableHeaderCell>
                  {money ? (
                    <>
                      <TableHeaderCell numeric>Revenue</TableHeaderCell>
                      <TableHeaderCell numeric>Cost</TableHeaderCell>
                      <TableHeaderCell numeric>Profit</TableHeaderCell>
                      <TableHeaderCell numeric>Margin</TableHeaderCell>
                      <TableHeaderCell numeric>Target</TableHeaderCell>
                      <TableHeaderCell>Minimum</TableHeaderCell>
                    </>
                  ) : null}
                  <TableHeaderCell className="pr-4">Month close</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {shown.map((row) => {
                  const minimum = row.minimum ? MINIMUM[row.minimum] : null;
                  return (
                    <TableRow key={row.month} className="h-11" data-testid="month-row">
                      <TableCell className="pl-4 whitespace-nowrap">
                        <PlaceLink href={href(row.month)} className="rounded-sm font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="month-open">
                          {monthLabel(row.month)}
                        </PlaceLink>
                        {row.month === currentMonth ? <span className="ml-2 text-xs text-fg-muted">This month</span> : null}
                      </TableCell>
                      <TableCell numeric className="font-medium">{units(row.units)}</TableCell>
                      <TableCell numeric className="text-fg-secondary">{hoursText(row.hours)}</TableCell>
                      <TableCell numeric className="text-fg-secondary">{formatPace(row.unitsPerHour, { empty: 'None' })}</TableCell>
                      {money ? (
                        <>
                          <TableCell numeric className="font-medium whitespace-nowrap"><Money cents={row.revenueCents} /></TableCell>
                          <TableCell numeric className="whitespace-nowrap text-fg-secondary"><Money cents={row.costCents} /></TableCell>
                          <TableCell numeric className="font-medium whitespace-nowrap"><Money cents={row.profitCents} /></TableCell>
                          <TableCell numeric><Margin marginBp={row.marginBp} targetBp={row.targetMarginBp} empty="None" /></TableCell>
                          <TableCell numeric className="text-fg-muted">{formatPercentBp(row.targetMarginBp, { digits: 0 })}</TableCell>
                          <TableCell>{minimum ? <Pill tone={minimum.tone}>{minimum.label}</Pill> : null}</TableCell>
                        </>
                      ) : null}
                      <TableCell className="pr-4 text-fg-secondary">{row.closed ? 'Closed' : 'Open'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DashSection>
        </>
      )}
    </DashboardFrame>
  );
}
