'use client';
/**
 * The Programs list (docs/programs/PULSE_PROGRAMS_SPEC.md 7.2): the month's headline tiles, one
 * row per tracked program (kits against plan, revenue, cost, profit, margin against target,
 * forecast margin, pace and health), footer totals, and "Not tracked yet" with "Track in Pulse".
 * Money columns and tiles are left out for a reader who cannot see money.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ExternalLink, FileText, MoreHorizontal, Repeat2, SquareArrowOutUpRight } from 'lucide-react';
import { ActionList, ActionRow, DashboardFrame, DashSection, EmptyNote, StatRow, StatTile, Tag } from '@kitstak/ui/dashboard';
import { Teach } from '@/components/pulse/teach';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { SearchInput } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/cn';
import { formatMoney, formatPace, formatPercentBp } from '@/lib/format';
import type { ProgramListDTO, ProgramListRowDTO, ProgramNotTrackedDTO } from '@/lib/program-types';
import { routes } from '@/lib/routes';
import type { ClientDTO } from '@/lib/types';
import { LoadError, SortHeader } from '@/features/profit/profit-ui';
import type { SortState } from '@/features/profit/profit-model';
import { useShell } from '@/features/shell/shell-context';
import { useUrlState, useUrlText } from '@/features/views/use-url-state';
import { HEALTH_ORDER, addMonth, capitalize, monthLabel, sumMoney } from './program-format';
import { ProgramReportDialog, type ProgramReportTarget } from './program-report-dialog';
import { HealthPill, Margin, Money, MonthPicker, PlanMeter, SectionSkeleton, StatusPill, units } from './program-ui';
import { TrackProgramDialog } from './track-program-dialog';
import { useProgramList } from './use-programs';

/** The month in the address bar, or this month. */
function useListMonth(currentMonth: string): { readonly month: string; readonly asked: string; readonly setMonth: (month: string) => void } {
  const url = useUrlState();
  const asked = url.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(asked) ? asked : currentMonth;
  return { month, asked: month === currentMonth ? '' : month, setMonth: (next) => url.set({ month: next === currentMonth ? null : next }) };
}

/** The month picker in the page header. It reads and writes the address bar, like the list. */
export function ProgramsMonthPicker({ currentMonth }: { readonly currentMonth: string }) {
  const { month, setMonth } = useListMonth(currentMonth);
  return <MonthPicker value={month} onChange={setMonth} latest={addMonth(currentMonth, 1)} />;
}

const matches = (row: { key: string; name: string; customerName: string | null; jobNumber?: string | null }, text: string): boolean => {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return [row.key, row.name, row.customerName ?? '', row.jobNumber ?? ''].join(' ').toLowerCase().includes(needle);
};

type SortKey = 'name' | 'units' | 'revenue' | 'cost' | 'profit' | 'margin' | 'forecast' | 'pace' | 'health';

const SORT_VALUE: Readonly<Record<SortKey, (row: ProgramListRowDTO) => number | string | null>> = {
  name: (row) => row.key,
  units: (row) => Number(row.units),
  revenue: (row) => row.revenueCents,
  cost: (row) => row.costCents,
  profit: (row) => row.profitCents,
  margin: (row) => row.marginBp,
  forecast: (row) => row.forecastMarginBp,
  pace: (row) => (row.unitsPerHour === null ? null : Number(row.unitsPerHour)),
  health: (row) => -HEALTH_ORDER[row.health],
};

function sortRows(rows: readonly ProgramListRowDTO[], sort: SortState): ProgramListRowDTO[] {
  const pick = SORT_VALUE[sort.column as SortKey] ?? SORT_VALUE.revenue;
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = pick(a);
    const right = pick(b);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === 'string' || typeof right === 'string') return String(left).localeCompare(String(right)) * sign;
    return (left - right) * sign;
  });
}

export interface ProgramsViewProps {
  readonly initialList: ProgramListDTO | undefined;
  /** The month the server read (`''` is this month). */
  readonly initialMonth: string;
  readonly currentMonth: string;
  /** Clients for "Track in Pulse" when a program has no matched client. */
  readonly clients: readonly ClientDTO[];
}

export function ProgramsView({ initialList, initialMonth, currentMonth, clients }: ProgramsViewProps) {
  const { appUrls, seesMoney } = useShell();
  const { month, asked } = useListMonth(currentMonth);
  const [search, setSearch] = useUrlText('q');
  const [sort, setSort] = useState<SortState>({ column: 'revenue', direction: 'desc' });
  const [report, setReport] = useState<ProgramReportTarget | null>(null);
  const [tracking, setTracking] = useState<ProgramNotTrackedDTO | null>(null);
  const query = useProgramList(asked, { initialData: asked === initialMonth ? initialList : undefined });
  const list = query.data;
  const money = Boolean(list && !list.moneyHidden);
  const rows = useMemo(() => sortRows((list?.programs ?? []).filter((row) => matches(row, search)), sort), [list, search, sort]);
  const notTracked = useMemo(() => (list?.notTracked ?? []).filter((row) => matches(row, search)), [list, search]);
  const projectsPrograms = `${appUrls.projects}/programs`;
  // Projects may not name a customer for any program yet: then the column says nothing and is left out.
  const showCustomer = (list?.programs ?? []).some((row) => row.customerName);
  const label = monthLabel(month);

  if (query.isError && !list) return <LoadError what="your programs" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />;
  if (!list) {
    return (
      <div className="rounded-xl border border-border-subtle bg-panel">
        <SectionSkeleton label="Loading your programs" rows={6} />
      </div>
    );
  }

  if (list.programs.length === 0 && list.notTracked.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-panel shadow-xs" data-testid="programs-empty">
        <Teach
          icon={Repeat2}
          title="No programs yet. Programs are set up in Projects."
          why="A program is recurring work under one price card. Once one runs in Projects, Pulse shows its kits, revenue, cost and margin here, month by month and by variant."
          points={['This month against the plan from Projects', 'Margin against the customer target', 'A monthly report for your team and for the customer']}
          actions={
            <a href={projectsPrograms} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="programs-open-projects">
              <ExternalLink aria-hidden className="size-4" />
              Open Projects
            </a>
          }
        />
      </div>
    );
  }

  const needLook = list.programs.filter((row) => row.health === 'at_risk' || row.health === 'losing');
  const forecast = sumMoney(list.programs.map((row) => row.forecastRevenueCents));
  const allUnits = list.totals.unitsByLabel.map((item) => `${units(item.units)} ${item.unitPlural}`).join(', ');
  const planned = list.programs.reduce((sum, row) => sum + Number(row.plannedUnits ?? 0), 0);
  const built = list.programs.reduce((sum, row) => sum + Number(row.units), 0);

  return (
    <DashboardFrame app="pulse" data-testid="programs-view">
      <StatRow label="This month across programs">
        {money ? (
          <StatTile label="Revenue so far" href={null} value={formatMoney(list.totals.revenueCents, { cents: false })} caption={forecast !== null ? <>Forecast <span className="font-medium text-fg tabular-nums">{formatMoney(forecast, { cents: false })}</span> from Projects</> : undefined} data-testid="programs-tile-revenue" />
        ) : (
          <StatTile label="Built so far" href={null} value={allUnits || '0'} caption={planned > 0 ? `${Math.round((built / planned) * 100)}% of the plan from Projects` : undefined} data-testid="programs-tile-units" />
        )}
        {money ? <StatTile label="Profit so far" href={null} value={<span className={cn((list.totals.profitCents ?? 0) < 0 && 'text-danger-text')}>{formatMoney(list.totals.profitCents, { cents: false })}</span>} caption={list.totals.marginBp !== null ? <>Margin <span className="font-medium text-fg tabular-nums">{formatPercentBp(list.totals.marginBp)}</span></> : 'No revenue yet'} data-testid="programs-tile-profit" /> : null}
        <StatTile
          label="Need a look"
          href={null}
          value={<span className={cn(needLook.length > 0 && 'text-warning-text')}>{needLook.length === 0 ? 'None' : String(needLook.length)}</span>}
          caption={needLook.length === 0 ? `All ${list.programs.length} ${list.programs.length === 1 ? 'program is' : 'programs are'} on track or close` : needLook.map((row) => row.key).join(', ')}
          data-testid="programs-tile-risk"
        />
        <StatTile label="Not tracked yet" href={list.notTracked.length > 0 ? '#not-tracked' : null} value={String(list.notTracked.length)} caption={list.notTracked.length === 0 ? 'Every program in Projects is tracked' : 'Running in Projects, no labor or cost here'} data-testid="programs-tile-untracked" />
      </StatRow>

      <DashSection
        title="Tracked programs"
        description={`${label}${list.month === currentMonth ? ', month to date' : ''}`}
        aside={<SearchInput value={search} onValueChange={setSearch} placeholder="Search programs" aria-label="Search programs" containerClassName="hidden w-[240px] sm:flex" data-testid="programs-search" />}
        flush
        data-testid="programs-table"
      >
        {/* Phones: the search sits on its own line under the title. */}
        <div className="border-b border-border-subtle p-3 sm:hidden">
          <SearchInput value={search} onValueChange={setSearch} placeholder="Search programs" aria-label="Search programs" containerClassName="w-full" />
        </div>
        {rows.length === 0 ? (
          <EmptyNote action={{ label: 'Show every program', href: routes.programs({ month: asked || undefined }) }}>No tracked program matches “{search}”.</EmptyNote>
        ) : (
          <div className={cn('transition-opacity', query.isFetching && query.isPlaceholderData && 'opacity-60')}>
            <ProgramCards rows={rows} month={asked} money={money} />
            <div className="hidden md:block">
              <Table aria-label="Tracked programs" className="min-w-[1080px]">
                <TableHead>
                  <tr>
                    <TableHeaderCell className="pl-4"><SortHeader id="name" label="Program" sort={sort} onSort={setSort} /></TableHeaderCell>
                    {showCustomer ? <TableHeaderCell className="hidden xl:table-cell">Customer</TableHeaderCell> : null}
                    <TableHeaderCell numeric><SortHeader id="units" label="Built" sort={sort} onSort={setSort} numeric /></TableHeaderCell>
                    <TableHeaderCell numeric>Planned</TableHeaderCell>
                    {money ? (
                      <>
                        <TableHeaderCell numeric><SortHeader id="revenue" label="Revenue" sort={sort} onSort={setSort} numeric /></TableHeaderCell>
                        <TableHeaderCell numeric><SortHeader id="cost" label="Cost" sort={sort} onSort={setSort} numeric /></TableHeaderCell>
                        <TableHeaderCell numeric><SortHeader id="profit" label="Profit" sort={sort} onSort={setSort} numeric /></TableHeaderCell>
                        <TableHeaderCell numeric><SortHeader id="margin" label="Margin" sort={sort} onSort={setSort} numeric title="Margin so far this month, against the customer target" /></TableHeaderCell>
                        <TableHeaderCell numeric><SortHeader id="forecast" label="Forecast margin" sort={sort} onSort={setSort} numeric title="Margin at month end if cost per kit holds" /></TableHeaderCell>
                      </>
                    ) : null}
                    <TableHeaderCell numeric><SortHeader id="pace" label="Per hour" sort={sort} onSort={setSort} numeric title="Units per labor hour" /></TableHeaderCell>
                    <TableHeaderCell><SortHeader id="health" label="Health" sort={sort} onSort={setSort} /></TableHeaderCell>
                    <TableHeaderCell className="pr-4"><span className="sr-only">Report and links</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.programId} className="group h-14" data-testid="program-row">
                      <TableCell className="pl-4">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Tag>{row.key}</Tag>
                          <div className="min-w-0">
                            <Link href={routes.program(row.key, { month: asked || undefined })} className="block truncate font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="program-link">
                              {row.name}
                            </Link>
                            <span className="block truncate text-xs text-fg-muted">
                              {row.jobNumber ?? 'No job yet'}
                              <span className="xl:hidden">{row.customerName ? ` · ${row.customerName}` : ''}</span>
                              {row.status !== 'active' ? ` · ${row.statusLabel}` : ''}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      {showCustomer ? <TableCell className="hidden max-w-[200px] truncate text-fg-secondary xl:table-cell">{row.customerName ?? <span className="text-fg-muted">Not set</span>}</TableCell> : null}
                      <TableCell numeric className="whitespace-nowrap">
                        <span className="font-medium">{units(row.units)}</span> <span className="text-xs text-fg-muted">{row.unit.plural}</span>
                      </TableCell>
                      <TableCell numeric className="w-[130px]">
                        {row.plannedUnits === null ? (
                          <span className="text-fg-muted">No plan</span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-fg-secondary">{units(row.plannedUnits)}</span>
                            <span className="w-20">
                              <PlanMeter built={row.units} planned={row.plannedUnits} label={`${row.key} built against planned`} />
                            </span>
                          </div>
                        )}
                      </TableCell>
                      {money ? (
                        <>
                          <TableCell numeric className="whitespace-nowrap font-medium"><Money cents={row.revenueCents} /></TableCell>
                          <TableCell numeric className="whitespace-nowrap text-fg-secondary"><Money cents={row.costCents} /></TableCell>
                          <TableCell numeric className="whitespace-nowrap font-medium"><Money cents={row.profitCents} /></TableCell>
                          <TableCell numeric className="whitespace-nowrap">
                            <div className="flex flex-col items-end">
                              <Margin marginBp={row.marginBp} targetBp={row.targetMarginBp} />
                              {row.targetMarginBp !== null ? <span className="text-xs text-fg-muted">target {formatPercentBp(row.targetMarginBp, { digits: 0 })}</span> : null}
                            </div>
                          </TableCell>
                          <TableCell numeric className="whitespace-nowrap"><Margin marginBp={row.forecastMarginBp} targetBp={row.targetMarginBp} empty="Not enough days" className="font-normal" /></TableCell>
                        </>
                      ) : null}
                      <TableCell numeric className="whitespace-nowrap text-fg-secondary">{row.unitsPerHour === null ? <span className="text-fg-muted">No hours</span> : formatPace(row.unitsPerHour)}</TableCell>
                      <TableCell><HealthPill health={row.health} reason={row.healthReason} /></TableCell>
                      <TableCell className="pr-4 text-right">
                        <RowMenu row={row} projectsUrl={appUrls.projects} onReport={() => setReport({ key: row.key, name: row.name, month })} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot>
                  <tr className="h-11 border-t-2 border-border-strong bg-sunken font-semibold" data-testid="programs-total">
                    <TableCell className="pl-4">Total</TableCell>
                    {showCustomer ? <TableCell className="hidden xl:table-cell" /> : null}
                    <TableCell numeric className="whitespace-nowrap" colSpan={2}>
                      {list.totals.unitsByLabel.map((item, index) => (
                        <span key={item.unitPlural}>
                          {index > 0 ? <span className="px-1 text-fg-muted">·</span> : null}
                          {units(item.units)} <span className="text-xs font-normal text-fg-muted">{item.unitPlural}</span>
                        </span>
                      ))}
                    </TableCell>
                    {money ? (
                      <>
                        <TableCell numeric className="whitespace-nowrap"><Money cents={list.totals.revenueCents} /></TableCell>
                        <TableCell numeric className="whitespace-nowrap"><Money cents={list.totals.costCents} /></TableCell>
                        <TableCell numeric className="whitespace-nowrap"><Money cents={list.totals.profitCents} /></TableCell>
                        <TableCell numeric className="whitespace-nowrap"><Margin marginBp={list.totals.marginBp} targetBp={null} /></TableCell>
                        <TableCell />
                      </>
                    ) : null}
                    <TableCell />
                    <TableCell />
                    <TableCell className="pr-4" />
                  </tr>
                </tfoot>
              </Table>
            </div>
            {search && rows.length < list.programs.length ? <p className="border-t border-border-subtle px-4 py-2 text-xs text-fg-muted">Showing {rows.length} of {list.programs.length} programs. The totals are for all of them.</p> : null}
          </div>
        )}
      </DashSection>

      {list.notTracked.length > 0 ? (
        <section id="not-tracked" className="scroll-mt-20">
          <DashSection title="Not tracked yet" description="These programs run in Projects. Track them here to see labor, cost and margin." flush data-testid="programs-not-tracked">
            {notTracked.length === 0 ? (
              <EmptyNote action={null}>No program here matches “{search}”.</EmptyNote>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {notTracked.map((program) => (
                  <li key={program.programId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="not-tracked-row">
                    <div className="flex min-w-0 flex-1 basis-full items-center gap-2.5 sm:basis-auto">
                      <Tag>{program.key}</Tag>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{program.name}</p>
                        <p className="text-xs text-fg-muted sm:truncate">
                          {[program.customerName ?? (program.matchedClient ? program.matchedClient.name : null), `Counts ${program.unit.plural}`, program.matchedClient ? null : 'No Pulse client matched yet'].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                    <StatusPill status={program.status} label={program.statusLabel} />
                    <a href={`${appUrls.projects}${program.projectsPath}`} className="inline-flex items-center gap-1 rounded-sm text-sm text-fg-secondary hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                      Open in Projects
                      <SquareArrowOutUpRight aria-hidden className="size-3.5" />
                    </a>
                    {list.canTrack ? (
                      <Button variant="secondary" leadingIcon={<Repeat2 aria-hidden />} onClick={() => setTracking(program)} data-testid="track-program">
                        Track in Pulse
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DashSection>
        </section>
      ) : null}

      <ProgramReportDialog target={report} onClose={() => setReport(null)} seesMoney={seesMoney} />
      <TrackProgramDialog program={tracking} clients={clients} onClose={() => setTracking(null)} />
    </DashboardFrame>
  );
}

function RowMenu({ row, projectsUrl, onReport }: { readonly row: ProgramListRowDTO; readonly projectsUrl: string; readonly onReport: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`More for ${row.key}`} icon={<MoreHorizontal aria-hidden />} size="sm" hideTooltip data-testid="program-row-menu" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem icon={<FileText aria-hidden />} onSelect={onReport} data-testid="program-row-report">
          Print report
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<SquareArrowOutUpRight aria-hidden />} onSelect={() => window.open(`${projectsUrl}${row.projectsPath}`, '_blank', 'noopener')}>
          Open in Projects
        </DropdownMenuItem>
        {row.jobNumber ? (
          <DropdownMenuItem asChild>
            <Link href={routes.programJob(row.jobNumber)} className="ks-menu-item">
              Open the job
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Phones: one row per program with the numbers that answer the page. `month` is `''` for this month. */
function ProgramCards({ rows, month, money }: { readonly rows: readonly ProgramListRowDTO[]; readonly month: string; readonly money: boolean }) {
  return (
    <div className="md:hidden">
      <ActionList label="Tracked programs">
        {rows.map((row) => (
          <ActionRow
            key={row.programId}
            href={routes.program(row.key, { month: month || undefined })}
            tag={row.key}
            title={row.name}
            reason={`${units(row.units)} of ${units(row.plannedUnits)} ${row.unit.plural}${money && row.marginBp !== null ? `, ${formatPercentBp(row.marginBp)} margin` : ''}`}
            meta={row.customerName ?? row.jobNumber ?? undefined}
            value={money ? formatMoney(row.revenueCents, { cents: false }) : `${capitalize(formatPace(row.unitsPerHour, { empty: 'No hours' }))}${row.unitsPerHour ? ' an hour' : ''}`}
            valueTone={(row.profitCents ?? 0) < 0 ? 'critical' : 'neutral'}
            valueCaption={money ? 'revenue' : undefined}
            marker={row.health === 'losing' ? 'critical' : row.health === 'at_risk' ? 'caution' : row.health === 'on_track' ? 'positive' : 'neutral'}
            shape="value"
            data-testid="program-card"
          />
        ))}
      </ActionList>
    </div>
  );
}
