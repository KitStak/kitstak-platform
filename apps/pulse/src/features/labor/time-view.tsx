'use client';
/**
 * Labor, Time: where paid time goes. Hours on jobs, time not on a job and paid time that is not
 * on any job, day by day, with the share of paid time spent on jobs and the payroll check.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Info, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, IconButton, IsoDatePicker, Popover, PopoverContent, PopoverTrigger, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { BarChart } from '@/components/charts/cartesian';
import { KpiTile } from '@/components/charts/stats';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { usePunches } from '@/features/log/floor-hooks';
import { parseTyped } from '@/features/log/log-math';
import { OtherTimeStrip } from '@/features/log/other-time';
import { useShell } from '@/features/shell/shell-context';
import { INDIRECT_REASONS, INDIRECT_REASON_LABELS, type IndirectReason } from '@/lib/constants';
import { formatHours, formatMoney, formatPercentBp } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { useJobs, useLaborSummary, useLogGrid } from '@/lib/hooks/use-data';
import { shortDate } from '@/lib/profit';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { LaborClassDTO, LaborSummaryDTO, SettingsDTO, SiteDTO } from '@/lib/types';
import { deletePunchesAction, restorePunchesAction, savePunchesAction } from '@/server/actions/floor';
import { RangeBar, useRange } from './range-bar';

const INVALIDATE = [qk.streams(), qk.jobsRoot(), qk.profitRoot(), qk.summaryRoot()] as const;

function Explain({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label={label} icon={<Info aria-hidden />} size="sm" variant="ghost" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-32px)] text-sm text-fg-secondary">
        <h3 className="mb-1 text-sm font-semibold text-fg">How we got this</h3>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function TimeView({ sites, laborClasses, settings, today }: { readonly sites: readonly SiteDTO[]; readonly laborClasses: readonly LaborClassDTO[]; readonly settings: SettingsDTO; readonly today: string }) {
  const shell = useShell();
  const { state, setState } = useRange(today, 'last_30');
  const summary = useLaborSummary({ from: state.from, to: state.to, siteId: state.siteId });
  const data = summary.data;
  const bridge = data?.bridge;
  const hasPaid = bridge ? Number(bridge.paidHours) > 0 : false;
  const direct = Number(bridge?.directHours ?? 0);
  const indirect = Number(bridge?.indirectHours ?? 0);
  const empty = data ? direct + indirect + Number(bridge?.paidHours ?? 0) === 0 : false;

  return (
    <div className="flex flex-col gap-4" data-testid="time-view">
      <RangeBar state={state} onChange={setState} sites={sites} today={today} />
      {summary.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} height={96} className="w-full" rounded="lg" />
          ))}
        </div>
      ) : summary.isError ? (
        <Panel>
          <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-base font-medium text-fg">We could not load the hours</p>
            <p className="text-sm text-fg-muted">{summary.error.message}</p>
            <Button variant="secondary" leadingIcon={<RefreshCw aria-hidden />} onClick={() => void summary.refetch()}>
              Try again
            </Button>
          </div>
        </Panel>
      ) : empty || !data || !bridge ? (
        <Panel>
          <Teach
            icon={Clock}
            title="No hours in these days"
            why="This tab shows where paid time goes: on jobs, on things like meetings and cleanup, or nowhere at all. The less time that goes missing, the more your job profit can be trusted."
            points={['Hours on jobs against time not on a job, day by day', 'Share of paid time spent on jobs', 'A check of logged hours against payroll']}
            actions={
              <>
                {shell.can('production:log') ? <ButtonLink href={routes.log()}>Log work</ButtonLink> : null}
                {shell.can('import:run') ? (
                  <ButtonLink href={routes.newImport('paid_hours')} variant="secondary">
                    Import paid hours
                  </ButtonLink>
                ) : null}
              </>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Hours on jobs" value={formatHours(bridge.directHours, { maxDigits: 0 })} footer={<span className="text-xs text-fg-muted">Production and extra services</span>} />
            <KpiTile
              label="Time not on a job"
              value={formatHours(bridge.indirectHours, { maxDigits: 0 })}
              footer={<span className="text-xs text-fg-muted">{bridge.indirectCents !== null ? `${formatMoney(bridge.indirectCents, { cents: false })} of meetings, cleanup and waiting` : 'Meetings, cleanup and waiting'}</span>}
            />
            <KpiTile
              label="Paid time not on any job"
              value={hasPaid ? formatHours(bridge.missingHours, { maxDigits: 0 }) : null}
              emptyText="Type paid hours to see this"
              footer={<span className="text-xs text-fg-muted">{hasPaid ? (bridge.missingCostCents !== null ? `${formatMoney(bridge.missingCostCents, { cents: false })} paid with no job or reason` : 'Paid, with no job or reason') : 'Paid hours minus all logged hours'}</span>}
              explain={
                <Explain label="How we got paid time not on any job">
                  <p>For each site and day: paid hours, minus hours on jobs, minus time not on a job. It is never below zero.</p>
                  <p className="mt-1 tabular-nums">
                    {formatHours(bridge.paidHours)} paid, {formatHours(direct)} on jobs, {formatHours(indirect)} not on a job.
                  </p>
                  {bridge.overLoggedDays > 0 ? <p className="mt-1">On {bridge.overLoggedDays} {bridge.overLoggedDays === 1 ? 'day' : 'days'} more hours were logged than paid. Those days count as zero here.</p> : null}
                </Explain>
              }
            />
            <KpiTile
              label="Share of paid time on jobs"
              value={bridge.utilizationBp === null ? null : formatPercentBp(bridge.utilizationBp)}
              footer={<span className="text-xs text-fg-muted">{hasPaid ? 'Hours on jobs divided by paid hours' : 'Hours on jobs divided by all logged hours'}</span>}
              explain={
                <Explain label="How we got the share of paid time on jobs">
                  <p>{hasPaid ? 'Hours on jobs divided by paid hours.' : 'No paid hours are typed for these days, so this is hours on jobs divided by hours on jobs plus time not on a job.'}</p>
                  <p className="mt-1 tabular-nums">
                    {formatHours(direct)} divided by {formatHours(hasPaid ? bridge.paidHours : direct + indirect)}.
                  </p>
                </Explain>
              }
            />
          </div>

          <PayrollCheck data={data} settings={settings} />

          <Panel title="Where the hours went, day by day">
            <BarChart
              title="Hours by day"
              description="Each bar is one day: hours on jobs, time not on a job, and paid time that is not on any job."
              dates={data.byDay.map((day) => day.date)}
              bucket="day"
              mode="stacked"
              format="hours"
              height={260}
              tableToggle
              series={[
                { id: 'direct', label: 'On jobs', values: data.byDay.map((day) => Number(day.directHours)) },
                { id: 'indirect', label: 'Not on a job', values: data.byDay.map((day) => Number(day.indirectHours)) },
                { id: 'missing', label: 'Paid, not on any job', values: data.byDay.map((day) => Number(day.missingHours)) },
              ]}
              emptyTitle="No hours on these days"
            />
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Time not on a job, by reason" bodyClassName="p-0">
              {data.byReason.length === 0 ? (
                <p className="px-4 py-6 text-sm text-fg-muted">Nothing is logged off the jobs in these days. If the crew met, cleaned up or waited on parts, add it under Other time below.</p>
              ) : (
                <Table>
                  <TableHead>
                    <TableRow className="hover:bg-transparent">
                      <TableHeaderCell>Reason</TableHeaderCell>
                      <TableHeaderCell numeric>Labor hours</TableHeaderCell>
                      <TableHeaderCell numeric>Share</TableHeaderCell>
                      {!data.moneyHidden ? <TableHeaderCell numeric>Cost</TableHeaderCell> : null}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byReason.map((row) => (
                      <TableRow key={row.reason}>
                        <TableCell>{INDIRECT_REASON_LABELS[row.reason as IndirectReason] ?? row.reason}</TableCell>
                        <TableCell numeric>{formatHours(row.hours)}</TableCell>
                        <TableCell numeric>{indirect > 0 ? formatPercentBp(Math.round((Number(row.hours) / indirect) * 10000), { digits: 0 }) : ''}</TableCell>
                        {!data.moneyHidden ? <TableCell numeric>{formatMoney(row.costCents)}</TableCell> : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
            <Panel title="Hours by labor class" bodyClassName="p-0">
              <Table>
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Labor class</TableHeaderCell>
                    <TableHeaderCell numeric>On jobs</TableHeaderCell>
                    <TableHeaderCell numeric>Not on a job</TableHeaderCell>
                    <TableHeaderCell numeric>Overtime</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.byClass.map((row) => (
                    <TableRow key={row.laborClassId ?? 'none'}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell numeric>{formatHours(row.directHours)}</TableCell>
                      <TableCell numeric>{formatHours(row.indirectHours)}</TableCell>
                      <TableCell numeric>{Number(row.overtimeHours) > 0 ? formatHours(row.overtimeHours) : ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </div>
        </>
      )}
      <DayEntry sites={sites} laborClasses={laborClasses} today={today} siteId={state.siteId} />
      <PunchesPanel sites={sites} laborClasses={laborClasses} from={state.from} to={state.to} siteId={state.siteId} today={today} />
    </div>
  );
}

/** The payroll check and, under the percent rule, "covered against real". Money readers only. */
function PayrollCheck({ data, settings }: { readonly data: LaborSummaryDTO; readonly settings: SettingsDTO }) {
  const bridge = data.bridge;
  if (data.moneyHidden) return null;
  const lines: React.ReactNode[] = [];
  if (bridge.paidCents !== null && bridge.paidCents > 0 && bridge.grossPayCents !== null && bridge.payrollGapCents !== null) {
    const gap = bridge.payrollGapCents;
    lines.push(
      <p key="payroll" data-testid="payroll-check">
        <span className="font-medium text-fg">Payroll check.</span> Payroll paid {formatMoney(bridge.paidCents, { cents: false })}. The hours in Pulse add up to {formatMoney(bridge.grossPayCents, { cents: false })} of pay.{' '}
        {gap > 0 ? (
          <span className="font-medium text-warning-text">{formatMoney(gap, { cents: false })} is not on any job or reason.</span>
        ) : gap < 0 ? (
          <span className="font-medium text-warning-text">That is {formatMoney(-gap, { cents: false })} more than payroll paid: check for hours typed twice.</span>
        ) : (
          <span className="font-medium text-success-text">They match.</span>
        )}
      </p>,
    );
  }
  if (settings.sharedCostRule === 'percent_of_labor' && bridge.sharedAppliedCents !== null && bridge.indirectCents !== null) {
    lines.push(
      <p key="covered">
        <span className="font-medium text-fg">Covered against real.</span> Your {formatPercentBp(settings.sharedPctBp, { digits: 0 })} covered {formatMoney(bridge.sharedAppliedCents, { cents: false })}. Real time not on a job cost {formatMoney(bridge.indirectCents, { cents: false })}.
      </p>,
    );
  }
  if (bridge.overLoggedDays > 0) {
    lines.push(
      <p key="over" className="flex items-start gap-1.5">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
        <span>
          On {bridge.overLoggedDays} {bridge.overLoggedDays === 1 ? 'day' : 'days'}, more hours were logged than were paid. Check the paid hours or the entries of those days.
        </span>
      </p>,
    );
  }
  if (lines.length === 0) return null;
  return <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-panel px-4 py-3 text-sm text-fg-secondary shadow-xs">{lines}</div>;
}

/** Other time and paid hours for one day, without leaving Labor. */
function DayEntry({ sites, laborClasses, today, siteId }: { readonly sites: readonly SiteDTO[]; readonly laborClasses: readonly LaborClassDTO[]; readonly today: string; readonly siteId: string | null }) {
  const shell = useShell();
  const [date, setDate] = useState(today);
  const [site, setSite] = useState<string | null>(siteId);
  const active = site ?? siteId ?? sites.find((item) => item.isDefault)?.id ?? sites[0]?.id ?? null;
  const grid = useLogGrid({ date, siteId: active }, { placeholderData: undefined });
  return (
    <Panel
      title="Add time for a day"
      action={
        <div className="flex items-center gap-2">
          {sites.length > 1 ? <Select aria-label="Site for the day" className="w-48" value={active ?? undefined} onValueChange={setSite} options={sites.map((item) => ({ value: item.id, label: item.name }))} /> : null}
          <IsoDatePicker aria-label="Day" value={date} onChange={(value) => value && setDate(value)} clearable={false} />
        </div>
      }
    >
      {grid.isLoading ? (
        <Skeleton height={96} className="w-full" />
      ) : grid.isError || !grid.data ? (
        <p role="alert" className="text-sm text-danger-text">
          We could not load this day. {grid.error?.message}
        </p>
      ) : (
        <>
          {grid.data.lockedReason ? <p className="mb-3 rounded-md bg-info-subtle px-3 py-2 text-sm text-info-text">{grid.data.lockedReason}</p> : null}
          <OtherTimeStrip date={grid.data.date} siteId={grid.data.siteId} indirect={grid.data.indirect} paid={grid.data.paid} laborClasses={laborClasses} canEdit={grid.data.canEdit && shell.can('production:log')} seesMoney={shell.seesMoney} shiftHours={grid.data.shiftHours} />
        </>
      )}
    </Panel>
  );
}

const fieldClass =
  'h-10 w-full min-w-0 rounded-md border border-border-input bg-panel px-2 text-sm tabular-nums text-fg placeholder:text-fg-placeholder hover:border-border-input-hover focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus sm:h-8';

/** Time punches: hours by person from a time clock or payroll file. They fill hours on jobs, other time and paid hours. */
function PunchesPanel({ sites, laborClasses, from, to, siteId, today }: { readonly sites: readonly SiteDTO[]; readonly laborClasses: readonly LaborClassDTO[]; readonly from: string; readonly to: string; readonly siteId: string | null; readonly today: string }) {
  const shell = useShell();
  const canLog = shell.can('production:log');
  const punches = usePunches({ from, to, siteId, limit: 500 });
  const [adding, setAdding] = useState(false);
  const jobs = useJobs({ tab: 'open', limit: 500 }, { enabled: adding });
  const [draft, setDraft] = useState({ date: today, code: '', name: '', target: '', classId: '', hours: '', overtime: '' });
  const [error, setError] = useState<string | null>(null);
  const save = useServerAction(savePunchesAction, { invalidate: INVALIDATE, silentError: true, onError: (problem) => setError(problem.message) });
  const remove = useServerAction(deletePunchesAction, { invalidate: INVALIDATE });
  const restore = useServerAction(restorePunchesAction, { invalidate: INVALIDATE });
  const classById = useMemo(() => new Map(laborClasses.map((item) => [item.id, item.name])), [laborClasses]);
  const rows = punches.data ?? [];

  async function submit() {
    const hours = parseTyped(draft.hours);
    const overtime = parseTyped(draft.overtime);
    if (!draft.code.trim()) return setError('Type the employee id from your time clock.');
    if (hours === null || hours <= 0) return setError('Type the hours this person worked.');
    if (overtime === null || overtime > hours) return setError('Overtime cannot be more than the hours.');
    setError(null);
    const isReason = (INDIRECT_REASONS as readonly string[]).includes(draft.target);
    const saved = await save.run({
      punches: [{ workDate: draft.date, siteId: siteId ?? undefined, employeeCode: draft.code.trim(), employeeName: draft.name.trim() || null, jobRef: !isReason && draft.target ? draft.target : null, reason: isReason ? (draft.target as IndirectReason) : null, laborClassId: draft.classId || null, hours: hours.toFixed(2), overtimeHours: overtime.toFixed(2) }],
    });
    if (!saved) return;
    toast.success('Punch saved', 'The hours of that day were added up again.');
    setDraft({ ...draft, code: '', name: '', hours: '', overtime: '' });
  }

  return (
    <Panel
      title="Time punches"
      action={
        <div className="flex items-center gap-2">
          {shell.can('production:log') ? (
            <ButtonLink href={routes.newImport('time_punches')} variant="tertiary" size="sm">
              Import a time clock file
            </ButtonLink>
          ) : null}
          {canLog && !adding ? (
            <Button variant="secondary" size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>
              Add a punch
            </Button>
          ) : null}
        </div>
      }
      bodyClassName="p-0"
    >
      <p className="px-4 pt-3 text-sm text-fg-muted">Hours by person, from a time clock or payroll. Pulse adds them up into labor hours on jobs, time not on a job and paid hours. A punch with no job and no reason shows up as paid time not on any job.</p>
      {adding ? (
        <form
          aria-label="Add a punch"
          className="m-4 grid grid-cols-2 items-end gap-2 rounded-lg border border-border-default bg-sunken p-3 lg:grid-cols-[140px_110px_minmax(0,1fr)_minmax(0,1.4fr)_150px_80px_80px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Day
            <input type="date" max={today} className={fieldClass} value={draft.date} onChange={(event) => event.target.value && setDraft({ ...draft, date: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Employee id
            <input className={fieldClass} value={draft.code} maxLength={60} onChange={(event) => setDraft({ ...draft, code: event.target.value })} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Name
            <input className={fieldClass} value={draft.name} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Job or reason
            <select className={cn(fieldClass, 'cursor-pointer')} value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })}>
              <option value="">Paid, not on any job</option>
              <optgroup label="Not on a job">
                {INDIRECT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {INDIRECT_REASON_LABELS[reason]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Jobs">
                {(jobs.data ?? []).map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.number} {job.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Labor class
            <select className={cn(fieldClass, 'cursor-pointer')} value={draft.classId} onChange={(event) => setDraft({ ...draft, classId: event.target.value })}>
              <option value="">Default class</option>
              {laborClasses
                .filter((item) => !item.archivedAt)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Hours
            <input className={cn(fieldClass, 'text-right')} inputMode="decimal" value={draft.hours} onChange={(event) => setDraft({ ...draft, hours: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Overtime
            <input className={cn(fieldClass, 'text-right')} inputMode="decimal" value={draft.overtime} onChange={(event) => setDraft({ ...draft, overtime: event.target.value })} />
          </label>
          <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
            <Button type="submit" loading={save.pending}>
              Save
            </Button>
            <Button type="button" variant="tertiary" onClick={() => setAdding(false)}>
              Done
            </Button>
          </div>
          {error ? (
            <p role="alert" className="col-span-full text-xs text-danger-text">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {punches.isLoading ? (
        <div className="p-4">
          <Skeleton height={40} className="w-full" />
        </div>
      ) : punches.isError ? (
        <p role="alert" className="px-4 py-4 text-sm text-danger-text">
          We could not load the punches. {punches.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-fg-secondary">No punches in these days. You do not need them: typed hours on the day grid work on their own. Use punches when your time clock already knows who worked on what.</p>
      ) : (
        <div className="mt-3 overflow-x-auto border-t border-border-subtle">
          <Table className="min-w-[640px]">
            <TableHead>
              <TableRow className="hover:bg-transparent">
                <TableHeaderCell>Day</TableHeaderCell>
                <TableHeaderCell>Person</TableHeaderCell>
                <TableHeaderCell>Job or reason</TableHeaderCell>
                <TableHeaderCell>Labor class</TableHeaderCell>
                <TableHeaderCell numeric>Hours</TableHeaderCell>
                <TableHeaderCell numeric>Overtime</TableHeaderCell>
                {sites.length > 1 ? <TableHeaderCell>Site</TableHeaderCell> : null}
                <TableHeaderCell className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="punch-row">
                  <TableCell className="whitespace-nowrap">{shortDate(row.workDate)}</TableCell>
                  <TableCell>
                    {row.employeeName ?? row.employeeCode}
                    {row.employeeName ? <span className="ml-1.5 text-xs text-fg-muted">{row.employeeCode}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate">{row.jobNumber ? `${row.jobNumber} ${row.jobName ?? ''}` : row.reason ? (INDIRECT_REASON_LABELS[row.reason as IndirectReason] ?? row.reason) : 'Paid, not on any job'}</TableCell>
                  <TableCell>{classById.get(row.laborClassId ?? '') ?? 'Default class'}</TableCell>
                  <TableCell numeric>{formatHours(row.hours)}</TableCell>
                  <TableCell numeric>{Number(row.overtimeHours) > 0 ? formatHours(row.overtimeHours) : ''}</TableCell>
                  {sites.length > 1 ? <TableCell>{sites.find((site) => site.id === row.siteId)?.name}</TableCell> : null}
                  <TableCell>
                    {canLog && !row.locked ? (
                      <IconButton
                        label={`Remove the punch of ${row.employeeName ?? row.employeeCode} on ${shortDate(row.workDate)}`}
                        icon={<Trash2 aria-hidden />}
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void remove.run({ ids: [row.id] }).then((gone) => {
                            if (gone) toast.undo('Punch removed', { description: 'The hours of that day were added up again.', onUndo: async () => void (await restore.run({ ids: [row.id] })) });
                          })
                        }
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
