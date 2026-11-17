'use client';
/** Labor, Cost: what labor adds up to by labor class, job type and client, and the overtime share. */
import { useMemo } from 'react';
import { Info, RefreshCw, Users } from 'lucide-react';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { BarChart } from '@/components/charts/cartesian';
import { KpiTile } from '@/components/charts/stats';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { formatHours, formatMoney, formatMoneyPerHour, formatPercentBp } from '@/lib/format';
import { useLaborSummary, useProfit } from '@/lib/hooks/use-data';
import { centsToNumber, perHourCents, ratioBp, sumCents } from '@/lib/money';
import { routes } from '@/lib/routes';
import type { ProfitRowDTO, SiteDTO } from '@/lib/types';
import { RangeBar, useRange } from './range-bar';

const perHour = (cents: number | null, hours: string | number): number | null => {
  if (cents === null) return null;
  const rate = perHourCents(cents, hours);
  return rate === null ? null : centsToNumber(rate);
};

/** Share of two hour totals in basis points, through the one rounding rule (hours as hundredths). */
const hoursShareBp = (part: number, whole: number): number | null => ratioBp(Math.round(part * 100), Math.round(whole * 100));

export function CostView({ sites, today }: { readonly sites: readonly SiteDTO[]; readonly today: string }) {
  const { state, setState } = useRange(today, 'last_30');
  const params = { from: state.from, to: state.to, siteId: state.siteId };
  const summary = useLaborSummary(params);
  const byType = useProfit('type', params);
  const byClient = useProfit('client', params);
  const data = summary.data;

  const totals = useMemo(() => {
    const classes = data?.byClass ?? [];
    const direct = classes.reduce((sum, row) => sum + Number(row.directHours), 0);
    const indirect = classes.reduce((sum, row) => sum + Number(row.indirectHours), 0);
    const overtime = classes.reduce((sum, row) => sum + Number(row.overtimeHours), 0);
    const labor = centsToNumber(sumCents(classes.map((row) => row.laborCents ?? 0)));
    const indirectCents = centsToNumber(sumCents(classes.map((row) => row.indirectCents ?? 0)));
    return { direct, indirect, overtime, labor, indirectCents, hours: direct + indirect };
  }, [data]);

  const revenue = byType.data?.total.revenueCents ?? null;

  if (summary.isLoading)
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <RangeBar state={state} onChange={setState} sites={sites} today={today} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} height={96} className="w-full" rounded="lg" />
          ))}
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4" data-testid="cost-view">
      <RangeBar state={state} onChange={setState} sites={sites} today={today} />
      {summary.isError ? (
        <Panel>
          <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-base font-medium text-fg">We could not load labor cost</p>
            <p className="text-sm text-fg-muted">{summary.error.message}</p>
            <Button variant="secondary" leadingIcon={<RefreshCw aria-hidden />} onClick={() => void summary.refetch()}>
              Try again
            </Button>
          </div>
        </Panel>
      ) : !data || totals.hours === 0 ? (
        <Panel>
          <Teach
            icon={Users}
            title="No labor cost in these days"
            why="Once hours are logged and a rate is set, labor cost shows here by kind of worker, job type and client, with the share that was overtime."
            points={['Labor cost by labor class, job type and client', 'Overtime share', 'Labor as a share of revenue']}
            actions={
              <>
                <ButtonLink href={routes.log()}>Log work</ButtonLink>
                <ButtonLink href={routes.labor('rates')} variant="secondary">
                  Set labor rates
                </ButtonLink>
              </>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Labor cost on jobs" value={formatMoney(totals.labor, { cents: false })} footer={<span className="text-xs text-fg-muted">{formatHours(totals.direct, { maxDigits: 0 })} labor hours</span>} />
            <KpiTile
              label="Real cost of an hour, on average"
              value={formatMoneyPerHour(perHour(totals.labor, totals.direct.toFixed(2)), { empty: 'No hours' })}
              footer={<span className="text-xs text-fg-muted">Labor cost divided by labor hours</span>}
              explain={
                <Popover>
                  <PopoverTrigger asChild>
                    <IconButton label="How we got the average cost of an hour" icon={<Info aria-hidden />} size="sm" variant="ghost" />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 max-w-[calc(100vw-32px)] text-sm text-fg-secondary">
                    <h3 className="mb-1 text-sm font-semibold text-fg">How we got this</h3>
                    <p className="tabular-nums">
                      {formatMoney(totals.labor)} of labor cost divided by {formatHours(totals.direct)} labor hours on jobs.
                    </p>
                    <p className="mt-1">Each entry was costed at the real cost of an hour for its labor class on that day: wage, plus taxes and benefits, plus overhead. Overtime hours cost more.</p>
                  </PopoverContent>
                </Popover>
              }
            />
            <KpiTile
              label="Labor as a share of revenue"
              value={revenue !== null && revenue > 0 ? formatPercentBp(ratioBp(totals.labor, revenue)) : null}
              emptyText="No revenue yet"
              footer={<span className="text-xs text-fg-muted">{revenue !== null ? `Of ${formatMoney(revenue, { cents: false })} earned` : 'Labor cost divided by earned revenue'}</span>}
            />
            <KpiTile label="Overtime share" value={totals.hours > 0 ? formatPercentBp(hoursShareBp(totals.overtime, totals.hours)) : null} footer={<span className="text-xs text-fg-muted">{formatHours(totals.overtime, { maxDigits: 0 })} overtime hours of {formatHours(totals.hours, { maxDigits: 0 })}</span>} />
          </div>

          <Panel title="Labor cost by labor class">
            <BarChart
              title="Labor cost by labor class"
              description="Money spent on hours on jobs and on time not on a job, for each labor class."
              labels={data.byClass.map((row) => row.name)}
              orientation="horizontal"
              mode="stacked"
              format="money"
              height={Math.max(160, data.byClass.length * 44)}
              tableToggle
              series={[
                { id: 'jobs', label: 'On jobs', values: data.byClass.map((row) => row.laborCents) },
                { id: 'indirect', label: 'Not on a job', values: data.byClass.map((row) => row.indirectCents) },
              ]}
            />
            <div className="mt-4 overflow-x-auto">
              <Table className="min-w-[620px]">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Labor class</TableHeaderCell>
                    <TableHeaderCell numeric>Labor hours</TableHeaderCell>
                    <TableHeaderCell numeric>Labor cost</TableHeaderCell>
                    <TableHeaderCell numeric>Cost of an hour</TableHeaderCell>
                    <TableHeaderCell numeric>Overtime share</TableHeaderCell>
                    <TableHeaderCell numeric>Not on a job</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.byClass.map((row) => {
                    const hours = Number(row.directHours) + Number(row.indirectHours);
                    return (
                      <TableRow key={row.laborClassId ?? 'none'}>
                        <TableCell>
                          {row.name}
                          {row.needsRate > 0 ? <span className="ml-2 text-xs text-warning-text">{row.needsRate} with no rate</span> : null}
                        </TableCell>
                        <TableCell numeric>{formatHours(row.directHours)}</TableCell>
                        <TableCell numeric>{formatMoney(row.laborCents)}</TableCell>
                        <TableCell numeric>{formatMoney(perHour(row.laborCents, row.directHours), { empty: '' })}</TableCell>
                        <TableCell numeric>{hours > 0 && Number(row.overtimeHours) > 0 ? formatPercentBp(hoursShareBp(Number(row.overtimeHours), hours)) : ''}</TableCell>
                        <TableCell numeric>{row.indirectCents ? formatMoney(row.indirectCents) : ''}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <GroupTable title="Labor cost by job type" first="Job type" rows={byType.data?.rows} loading={byType.isLoading} error={byType.isError ? byType.error.message : null} />
            <GroupTable title="Labor cost by client" first="Client" rows={byClient.data?.rows} loading={byClient.isLoading} error={byClient.isError ? byClient.error.message : null} />
          </div>
        </>
      )}
    </div>
  );
}

function GroupTable({ title, first, rows, loading, error }: { readonly title: string; readonly first: string; readonly rows: readonly ProfitRowDTO[] | undefined; readonly loading: boolean; readonly error: string | null }) {
  const sorted = useMemo(() => [...(rows ?? [])].filter((row) => (row.laborCents ?? 0) !== 0 || Number(row.hours) > 0).sort((a, b) => (b.laborCents ?? 0) - (a.laborCents ?? 0)), [rows]);
  return (
    <Panel title={title} bodyClassName="p-0">
      {loading ? (
        <div className="p-4">
          <Skeleton height={120} className="w-full" />
        </div>
      ) : error ? (
        <p role="alert" className="px-4 py-4 text-sm text-danger-text">
          We could not load this table. {error}
        </p>
      ) : sorted.length === 0 ? (
        <p className="px-4 py-6 text-sm text-fg-muted">No labor cost in these days.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[520px]">
            <TableHead>
              <TableRow className="hover:bg-transparent">
                <TableHeaderCell>{first}</TableHeaderCell>
                <TableHeaderCell numeric>Labor hours</TableHeaderCell>
                <TableHeaderCell numeric>Labor cost</TableHeaderCell>
                <TableHeaderCell numeric>Cost of an hour</TableHeaderCell>
                <TableHeaderCell numeric>Share of revenue</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="max-w-[240px] truncate" title={row.label}>
                    {row.label}
                  </TableCell>
                  <TableCell numeric>{formatHours(row.hours)}</TableCell>
                  <TableCell numeric>{formatMoney(row.laborCents)}</TableCell>
                  <TableCell numeric>{formatMoney(perHour(row.laborCents, row.hours), { empty: '' })}</TableCell>
                  <TableCell numeric>{row.laborPctBp === null ? '' : formatPercentBp(row.laborPctBp)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
