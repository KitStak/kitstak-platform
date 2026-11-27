'use client';
/**
 * Labor (spec 7.3, tab 5): hours and cost by labor class and by person for the month, with prep
 * work from Projects (`pmt:` rows) on its own row, "Prep work in Projects".
 */
import { DashSection, DashboardFrame, EmptyNote, StatRow, StatTile } from '@kitstak/ui/dashboard';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/cn';
import { formatHours, formatMoney, formatPace, formatPercentBp } from '@/lib/format';
import type { ProgramLaborDTO } from '@/lib/program-types';
import { divRound, hoursToScaled } from '@/lib/money';
import { routes } from '@/lib/routes';
import { LoadError } from '@/features/profit/profit-ui';
import { capitalize, monthLabel } from './program-format';
import { Money, SectionSkeleton, hoursText } from './program-ui';
import { useProgramLabor } from './use-programs';

function HoursShare({ bp }: { readonly bp: number | null }) {
  const share = bp === null ? 0 : Math.max(0, Math.min(1, bp / 10000));
  return (
    <span className="inline-flex w-full items-center justify-end gap-2">
      <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--pulse-chart-track)]">
        <span className="block h-full rounded-full bg-[var(--pulse-series-1)]" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="w-12 text-right tabular-nums">{formatPercentBp(bp, { fixed: true, empty: 'None' })}</span>
    </span>
  );
}

export function ProgramLabor({ programKey, month, initial }: { readonly programKey: string; readonly month: string; readonly currentMonth: string; readonly initial?: ProgramLaborDTO }) {
  const query = useProgramLabor(programKey, month, { initialData: initial && initial.month.month === month ? initial : undefined });
  const data = query.data;
  if (query.isError && !data) return <LoadError what="the labor" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />;
  if (!data) return <div className="rounded-xl border border-border-subtle bg-panel"><SectionSkeleton label="Loading the labor" rows={8} /></div>;
  const money = !data.moneyHidden;
  const unit = data.header.unit;
  const hasPay = data.byPerson.some((person) => person.payCents !== null);
  const perHour = money && data.totals.laborCents !== null && Number(data.totals.hours) > 0 ? Number(divRound(BigInt(data.totals.laborCents) * BigInt(100), hoursToScaled(data.totals.hours))) : null;
  const empty = Number(data.totals.hours) === 0;
  const hasPrep = data.byPerson.some((person) => Number(person.prepHours) !== 0);

  return (
    <DashboardFrame app="pulse" data-testid="program-labor">
      <StatRow label={`Labor in ${monthLabel(data.month.month)}`}>
        <StatTile label="Labor hours" href={null} value={formatHours(data.totals.hours)} caption={Number(data.hoursWithoutName) > 0 ? `${formatHours(data.hoursWithoutName)} with no name on them` : 'Every hour has a name'} />
        {money ? <StatTile label="Labor cost" href={null} value={formatMoney(data.totals.laborCents)} caption={perHour !== null ? `${formatMoney(perHour)} an hour on average` : undefined} /> : null}
        <StatTile label={`${capitalize(unit.plural)} per hour`} href={null} value={formatPace(data.totals.unitsPerHour, { empty: 'No hours yet' })} caption="Good units for each labor hour" />
      </StatRow>

      <div className={cn('grid items-start gap-4 xl:grid-cols-2', query.isFetching && query.isPlaceholderData && 'opacity-60')}>
        <DashSection title="By labor class" description="Each class at its real cost of an hour" action={{ label: 'Labor rates', href: routes.labor('rates') }} flush data-testid="labor-by-class">
          {empty || data.byClass.length === 0 ? (
            <EmptyNote action={{ label: 'Log work', href: routes.log() }}>No hours on this program this month yet.</EmptyNote>
          ) : (
            <Table aria-label="Hours by labor class">
              <TableHead>
                <tr>
                  <TableHeaderCell className="pl-4">Labor class</TableHeaderCell>
                  <TableHeaderCell numeric>Hours</TableHeaderCell>
                  <TableHeaderCell numeric>Share of hours</TableHeaderCell>
                  {money ? <TableHeaderCell numeric className="pr-4">Labor cost</TableHeaderCell> : null}
                </tr>
              </TableHead>
              <TableBody>
                {data.byClass.map((row) => (
                  <TableRow key={`${row.kind}-${row.laborClassId ?? 'none'}`} className="h-10" data-testid={row.kind === 'prep' ? 'labor-prep' : 'labor-class'}>
                    <TableCell className="pl-4">
                      <span className={cn('font-medium', row.kind === 'prep' ? 'text-fg-secondary' : 'text-fg')}>{row.name}</span>
                      {row.kind === 'prep' ? <span className="block text-xs text-fg-muted">Time on program tasks that are not builds</span> : null}
                    </TableCell>
                    <TableCell numeric>{hoursText(row.hours)}</TableCell>
                    <TableCell numeric className="w-[160px]"><HoursShare bp={row.hoursShareBp} /></TableCell>
                    {money ? <TableCell numeric className="pr-4 whitespace-nowrap"><Money cents={row.laborCents} /></TableCell> : null}
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <tr className="h-11 border-t-2 border-border-strong bg-sunken font-semibold">
                  <TableCell className="pl-4">Total</TableCell>
                  <TableCell numeric>{hoursText(data.totals.hours)}</TableCell>
                  <TableCell />
                  {money ? <TableCell numeric className="pr-4 whitespace-nowrap"><Money cents={data.totals.laborCents} /></TableCell> : null}
                </tr>
              </tfoot>
            </Table>
          )}
        </DashSection>

        <DashSection title="By person" description="Time logged in Projects and time punches on the program job" flush data-testid="labor-by-person">
          {data.byPerson.length === 0 ? (
            <EmptyNote action={{ label: 'Where paid time goes', href: routes.labor('time') }}>No hours with a name on them this month. Crew hours typed in the daily log have no names.</EmptyNote>
          ) : (
            <Table aria-label="Hours by person">
              <TableHead>
                <tr>
                  <TableHeaderCell className="pl-4">Person</TableHeaderCell>
                  <TableHeaderCell numeric>Builds</TableHeaderCell>
                  {hasPrep ? <TableHeaderCell numeric>Prep</TableHeaderCell> : null}
                  <TableHeaderCell numeric className={cn(!hasPay && 'pr-4')}>Hours</TableHeaderCell>
                  {hasPay ? <TableHeaderCell numeric className="pr-4">Pay</TableHeaderCell> : null}
                </tr>
              </TableHead>
              <TableBody>
                {data.byPerson.map((person) => (
                  <TableRow key={`${person.source}-${person.personId}`} className="h-10" data-testid="labor-person">
                    <TableCell className="pl-4">
                      <span className="font-medium text-fg">{person.name}</span>
                      <span className="block text-xs text-fg-muted">{person.source === 'projects' ? 'Logged in Projects' : 'Time punches'}</span>
                    </TableCell>
                    <TableCell numeric className="text-fg-secondary">{Number(person.buildHours) === 0 ? '' : hoursText(person.buildHours)}</TableCell>
                    {hasPrep ? <TableCell numeric className="text-fg-secondary">{Number(person.prepHours) === 0 ? '' : hoursText(person.prepHours)}</TableCell> : null}
                    <TableCell numeric className={cn('font-medium', !hasPay && 'pr-4')}>{hoursText(person.hours)}</TableCell>
                    {hasPay ? <TableCell numeric className="pr-4 whitespace-nowrap">{person.payCents === null ? '' : <Money cents={person.payCents} />}</TableCell> : null}
                  </TableRow>
                ))}
                {Number(data.hoursWithoutName) > 0 ? (
                  <TableRow className="h-10" data-testid="labor-no-name">
                    <TableCell className="pl-4">
                      <span className="font-medium text-fg-secondary">No name on them</span>
                      <span className="block text-xs text-fg-muted">Crew hours typed in the daily log</span>
                    </TableCell>
                    <TableCell />
                    {hasPrep ? <TableCell /> : null}
                    <TableCell numeric className={cn('font-medium', !hasPay && 'pr-4')}>{hoursText(data.hoursWithoutName)}</TableCell>
                    {hasPay ? <TableCell className="pr-4" /> : null}
                  </TableRow>
                ) : null}
              </TableBody>
              <tfoot>
                <tr className="h-11 border-t-2 border-border-strong bg-sunken font-semibold">
                  <TableCell className="pl-4">Total</TableCell>
                  <TableCell />
                  {hasPrep ? <TableCell /> : null}
                  <TableCell numeric className={cn(!hasPay && 'pr-4')}>{hoursText(data.totals.hours)}</TableCell>
                  {hasPay ? <TableCell className="pr-4" /> : null}
                </tr>
              </tfoot>
            </Table>
          )}
        </DashSection>
      </div>
    </DashboardFrame>
  );
}
