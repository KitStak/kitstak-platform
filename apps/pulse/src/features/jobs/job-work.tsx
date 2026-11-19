'use client';
/**
 * Work log: every day of work on this job, with one form to add or edit a day, delete with a
 * question first and undo after, the daily units and pace against the target, and a CSV export.
 */
import { useMemo, useRef, useState } from 'react';
import { ClipboardPen, Download, Lock, Pencil, Trash2 } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
} from '@/components/ui';
import { ComboChart } from '@/components/charts/cartesian';
import { KpiTile } from '@/components/charts/stats';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { PersonAvatar } from '@/components/pulse/person';
import { Teach } from '@/components/pulse/teach';
import { useShell } from '@/features/shell/shell-context';
import { SUPERVISOR_EDIT_DAYS } from '@/lib/constants';
import { toCsv } from '@/lib/csv/write';
import {
  formatHours,
  formatMoney,
  formatMoneyPerHour,
  formatMoneyPlain,
  formatNumber,
  formatPace,
} from '@/lib/format';
import { laborCostPerUnit, paceDays, unitsPerHour } from '@/lib/profit';
import { toCents } from '@/lib/money';
import { shortDate, weekdayName } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import { deleteProductionEntriesAction, restoreProductionEntriesAction } from '@/server/actions/log';
import { WorkEntryForm, type DaySaved } from './forms/work-entry-form';
import { useDeleteWithUndo, useJobProduction, useRefreshJob } from './job-data';
import { rowPace, shiftDate, singularUnit } from './job-math';
import type { JobTabProps } from './job-overview';
import { Explain, LoadError } from './job-ui';
import { groupWorkDays, hasShifts, isEmptyEntry, laborLineWords, restoreDayLines, saveDay, shiftWords, type WorkDay } from './work-days';

const SOURCE_WORDS: Readonly<Record<string, string>> = {
  manual: 'Typed in',
  csv: 'Spreadsheet',
  wms: 'From the warehouse',
  projects: 'From Projects',
  punch: 'Time clock',
  sample: 'Sample data',
  crm: 'CRM',
  system: 'Pulse',
};

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** "Nov 17", with the year when it is not this year, so a slip like 2030 cannot hide. */
const dayLabel = (date: string, today: string): string =>
  date.slice(0, 4) === today.slice(0, 4) ? shortDate(date) : `${shortDate(date)}, ${date.slice(0, 4)}`;

const people = (count: string | null | undefined): string =>
  `${formatNumber(count)} ${Number(count) === 1 ? 'person' : 'people'}`;

export function JobWork({ job, today, settings, laborClasses }: JobTabProps) {
  const shell = useShell();
  const refresh = useRefreshJob();
  const removeWithUndo = useDeleteWithUndo(refresh);
  const production = useJobProduction(job.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<WorkDay | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const unit = singularUnit(job.unitLabel);
  const seesMoney = shell.seesMoney && !job.stats.moneyHidden;
  const canLog = shell.can('production:log');
  const canEditAny = shell.can('production:edit_any');
  const classNames = useMemo(() => new Map(laborClasses.map((item) => [item.id, item.name])), [laborClasses]);
  const oldest = shiftDate(today, -SUPERVISOR_EDIT_DAYS);
  const canEdit = (day: WorkDay) =>
    canLog && !day.locked && (canEditAny || day.workDate >= oldest);
  const jobOpen = job.status === 'active' || job.status === 'on_hold' || job.status === 'planned';

  // A row with nothing on it (every box cleared on Log work) is not a day of work: it stays out.
  const rows = useMemo(
    () =>
      (production.data ?? []).filter((row) => row.deletedAt === null && !hidden.has(row.id) && !isEmptyEntry(row)),
    [production.data, hidden],
  );

  const days = useMemo(() => groupWorkDays(rows), [rows]);
  const editingDay = days.find((day) => day.workDate === editingId) ?? null;
  const className = (id: string | null) => (id ? (classNames.get(id) ?? 'Labor class') : 'Not set');
  const crewNames = (day: WorkDay) => day.laborClassIds.map(className).join(', ');
  /** "Machine operator, night shift" when the day has lines on more than one shift. */
  const lineName = (day: WorkDay, row: WorkDay['rows'][number]) => {
    const shift = hasShifts(day.rows) ? (shiftWords(row.shift) ?? 'Day shift').toLowerCase() : null;
    return shift ? `${className(row.laborClassId)}, ${shift}` : className(row.laborClassId);
  };
  /**
   * After a save or a Cancel, the keyboard goes back to the Edit button of that day in the list
   * (the table on a wide screen, the card below 1024px), the control that opened the edit.
   */
  const focusDay = (workDate: string) =>
    requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-testid="work-edit-${workDate}"], [data-testid="work-card-edit-${workDate}"]`)].find((element) => element.getClientRects().length > 0);
      target?.focus();
    });
  const openDay = (workDate: string) => {
    setEditingId(workDate);
    // The one form sits at the top of the tab: bring it into view and put the keyboard in it.
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      formRef.current?.querySelector<HTMLElement>('[data-testid="work-good"]')?.focus({ preventScroll: true });
    });
  };

  const chart = useMemo(() => {
    const days = paceDays(
      rows.map((row) => ({
        workDate: row.workDate,
        unitsGood: row.unitsGood,
        hours: row.hours,
        setupHours: row.setupHours,
        hoursConfirmed: row.hoursConfirmed,
        source: row.source,
      })),
    );
    return {
      labels: days.map((day) => shortDate(day.workDate)),
      units: days.map((day) => day.unitsGood),
      pace: days.map((day) => (day.counted ? unitsPerHour(day.unitsGood, day.paceHours) : null)),
    };
  }, [rows]);

  const laborPerUnit =
    seesMoney && Number(job.stats.unitsGood) > 0
      ? laborCostPerUnit(toCents(job.stats.laborCents ?? 0), job.stats.unitsGood)
      : null;

  const exportCsv = () => {
    const headers = [
      'Day',
      'Labor class',
      'Good units',
      'Scrapped',
      'Reworked',
      'People',
      'Labor hours',
      'Setup hours',
      'Overtime hours',
      'Pace',
      ...(seesMoney ? ['Cost of an hour', 'Labor cost'] : []),
      'Source',
      'Note',
    ];
    const body = rows.map((row) => [
      row.workDate,
      row.laborClassId ? (classNames.get(row.laborClassId) ?? '') : '',
      row.unitsGood,
      row.unitsScrap,
      row.unitsRework,
      row.headcount,
      row.hours,
      row.setupHours,
      row.overtimeHours,
      rowPace(row),
      ...(seesMoney
        ? [
            row.rateCents === null ? null : formatMoneyPlain(row.rateCents),
            row.laborCostCents === null ? null : formatMoneyPlain(row.laborCostCents),
          ]
        : []),
      SOURCE_WORDS[row.source] ?? row.source,
      row.note,
    ]);
    download(`pulse-${job.number}-work-log.csv`, toCsv(headers, body));
    toast.success(`Exported ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`);
  };

  const remove = (day: WorkDay) => {
    const ids = day.rows.map((row) => row.id);
    if (editingId === day.workDate) setEditingId(null);
    void removeWithUndo({
      label: `the work for ${dayLabel(day.workDate, today)}`,
      hide: () => setHidden((current) => new Set([...current, ...ids])),
      show: () =>
        setHidden((current) => {
          const next = new Set(current);
          for (const id of ids) next.delete(id);
          return next;
        }),
      remove: () => deleteProductionEntriesAction({ ids }),
      restore: () => restoreProductionEntriesAction({ ids }),
    });
  };

  const saved = async (result: DaySaved) => {
    setEditingId(null);
    await refresh();
    if (result.mode === 'edit') focusDay(result.workDate);
    const label = dayLabel(result.workDate, today);
    const ids = result.entries.map((row) => row.id);
    if (result.mode === 'create') {
      toast.undo(`Added the work for ${label}`, {
        onUndo: async () => {
          const gone = await deleteProductionEntriesAction({ ids });
          if (!gone.ok) throw new Error(gone.error.message);
          await refresh();
          toast.success(`Took the work for ${label} back off`);
        },
      });
      return;
    }
    const before = result.before;
    if (!before) return;
    // Undo puts the day back exactly as it was read: every row, its units, people and hours.
    toast.undo(`Saved the work for ${label}`, {
      description: 'Undo puts the day back the way it was.',
      onUndo: async () => {
        const live = new Set(ids);
        const back = await saveDay({
          jobId: job.id,
          workDate: before.workDate,
          mode: 'edit',
          fromDate: result.workDate,
          read: result.entries.map((row) => ({ id: row.id, version: row.version })),
          lines: restoreDayLines(before.rows, live),
        });
        if (!back.ok)
          throw new Error(
            back.reason === 'stale' ? 'The day was changed again after your save, so it was left as it is.' : back.message,
          );
        await refresh();
        toast.success(`Put the work for ${dayLabel(before.workDate, today)} back`);
      },
    });
  };

  if (production.isError && !production.data)
    return (
      <LoadError
        what="the work log"
        message={production.error instanceof Error ? production.error.message : undefined}
        onRetry={() => void production.refetch()}
      />
    );

  return (
    <div className="flex flex-col gap-5" data-testid="job-work">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label={`Good ${job.unitLabel}`}
          explain={
            <Explain
              title={`Good ${job.unitLabel}`}
              rule="Good units from every row on the work log, added up. Scrap and rework are counted on their own and never earn revenue."
              rows={[
                { label: 'Good units', value: formatNumber(job.stats.unitsGood, { maxDigits: 0 }), kind: 'total' },
                { label: 'Scrapped units', value: formatNumber(job.stats.unitsScrap, { maxDigits: 0 }), kind: 'note' },
              ]}
            />
          }
          value={formatNumber(job.stats.unitsGood, { maxDigits: 0 })}
          footer={
            <span className="text-xs text-fg-muted">
              {formatNumber(job.stats.unitsScrap, { maxDigits: 0 })} scrapped
            </span>
          }
        />
        <KpiTile
          label="Labor hours"
          explain={
            <Explain
              title="Labor hours"
              rule="People times hours each, added up over every row on the work log. Overtime hours are part of the total."
              rows={[
                { label: 'Hours logged', value: formatHours(job.stats.hours), kind: 'total' },
                { label: 'of that, overtime', value: formatHours(job.stats.overtimeHours), kind: 'note' },
              ]}
            />
          }
          value={formatHours(job.stats.hours, { maxDigits: 0 })}
          footer={
            <span className="text-xs text-fg-muted">
              {job.planLaborHours
                ? `plan ${formatHours(job.planLaborHours, { maxDigits: 0 })}`
                : 'no plan hours'}
              {Number(job.stats.overtimeHours) > 0
                ? `, ${formatHours(job.stats.overtimeHours, { maxDigits: 0 })} overtime`
                : ''}
            </span>
          }
        />
        <KpiTile
          label="Pace"
          explain={
            <Explain
              title="Pace"
              rule="Good units over labor hours: how many units one person finishes in an hour. Only days with both units and hours count, so a day with missing hours cannot make the pace look fast."
              rows={[
                { label: 'Pace on counted days', value: job.stats.uph === null ? 'No counted day yet' : formatPace(job.stats.uph), kind: 'total' },
                { label: 'Target pace', value: job.stats.standardUph === null ? 'Not set' : formatPace(job.stats.standardUph), kind: 'note' },
              ]}
            />
          }
          value={job.stats.uph === null ? null : formatPace(job.stats.uph)}
          emptyText="No counted day yet"
          footer={
            <span className="text-xs text-fg-muted">
              {job.stats.standardUph !== null
                ? `target ${formatPace(job.stats.standardUph)}`
                : 'no target pace'}
            </span>
          }
        />
        {seesMoney ? (
          <KpiTile
            label={`Labor cost for one ${unit}`}
            value={laborPerUnit === null ? null : formatMoney(laborPerUnit)}
            emptyText="No units yet"
            footer={
              <span className="text-xs text-fg-muted">
                {formatMoney(job.stats.laborCents, { cents: false })} of labor
              </span>
            }
            explain={
              <Explain
                title={`Labor cost for one ${unit}`}
                rule="Labor cost so far over the good units made. Labor cost is hours times the real cost of an hour for the crew that day."
                rows={[
                  { label: 'Labor cost', value: formatMoney(job.stats.laborCents) },
                  { label: 'Good units', value: formatNumber(job.stats.unitsGood) },
                  {
                    label: `Labor cost for one ${unit}`,
                    value: laborPerUnit === null ? 'No units yet' : formatMoney(laborPerUnit),
                    kind: 'total',
                  },
                ]}
              />
            }
          />
        ) : (
          <KpiTile
            label="Days logged"
            explain={
              <Explain
                title="Days logged"
                rule="A count of the days that have at least one row on the work log for this job."
                rows={[{ label: 'Days with work logged', value: formatNumber(chart.labels.length), kind: 'total' }]}
              />
            }
            value={formatNumber(chart.labels.length)}
            footer={
              <span className="text-xs text-fg-muted">
                {job.stats.lastEntryDate ? `last on ${shortDate(job.stats.lastEntryDate)}` : 'none yet'}
              </span>
            }
          />
        )}
      </div>

      {canLog && (jobOpen || editingDay) ? (
        <div ref={formRef} className="scroll-mt-24">
          <Panel
            title={editingDay ? `Edit the work for ${dayLabel(editingDay.workDate, today)}` : 'Add a day of work'}
            action={
              <ButtonLink
                href={routes.log({ job: job.number })}
                variant="ghost"
                size="sm"
                icon={<ClipboardPen aria-hidden />}
              >
                Open the daily log
              </ButtonLink>
            }
          >
            {/* One form at a time: it adds a day, or edits the day picked in the list below. */}
            <WorkEntryForm
              key={
                editingDay
                  ? `edit:${editingDay.workDate}:${editingDay.rows.map((row) => `${row.id}.${row.version}`).join(',')}`
                  : 'add'
              }
              jobId={job.id}
              unit={job.unitLabel}
              day={editingDay}
              days={days}
              today={today}
              startDate={job.startDate}
              shiftHours={settings.defaultShiftHours}
              laborClasses={laborClasses}
              defaultLaborClassId={job.defaultLaborClassId}
              onSaved={saved}
              onCancel={
                editingDay
                  ? () => {
                      const workDate = editingDay.workDate;
                      setEditingId(null);
                      focusDay(workDate);
                    }
                  : undefined
              }
              onOpenDay={openDay}
              onStale={refresh}
            />
          </Panel>
        </div>
      ) : !jobOpen ? (
        <p className="rounded-xl border border-border-subtle bg-panel px-4 py-3 text-sm text-fg-secondary">
          This job is {job.status === 'completed' ? 'complete' : 'cancelled'}, so no new days can be added.
          Reopen it from the stage menu to log more work.
        </p>
      ) : null}

      {rows.length > 0 && chart.labels.length === 1 ? (
        // One day draws one bar in a tall empty box. Say it in a line until there are two days to compare.
        <Panel title="Units and pace by day" bodyClassName="px-4 py-3 min-w-0">
          <p className="text-sm text-fg-secondary" data-testid="work-one-day">
            One day so far: {formatNumber(chart.units[0], { maxDigits: 0 })} good {job.unitLabel} on {chart.labels[0]}
            {chart.pace[0] !== null && chart.pace[0] !== undefined ? `, a pace of ${formatPace(chart.pace[0])} per person per hour` : ''}. The
            chart shows once there are two days to compare.
          </p>
        </Panel>
      ) : rows.length > 0 ? (
        <Panel title="Units and pace by day" bodyClassName="p-4 min-w-0">
          <ComboChart
            title={`Good ${job.unitLabel} each day, with the pace`}
            description="Bars are the units made that day. The line is units per person per hour, against the target pace."
            labels={chart.labels}
            bars={[{ id: 'units', label: `Good ${job.unitLabel}`, values: chart.units }]}
            lines={[{ id: 'pace', label: 'Pace', values: chart.pace }]}
            barFormat="number"
            lineFormat="number"
            lineTarget={
              job.stats.standardUph !== null
                ? { value: Number(job.stats.standardUph), label: 'Target pace' }
                : undefined
            }
            height={300}
            tableToggle
          />
        </Panel>
      ) : null}

      <Panel
        title="Entries"
        action={
          rows.length > 0 && shell.can('export:run') ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Download aria-hidden />}
              onClick={exportCsv}
              data-testid="work-export"
            >
              Export CSV
            </Button>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {production.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-busy="true">
            <span className="sr-only">Loading the work log</span>
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} height={28} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Teach
            testId="work-empty"
            size="sm"
            icon={ClipboardPen}
            title="No work logged yet"
            why="Each day, type how many units were made, how many people worked and for how long. Pulse turns that into labor cost, pace and profit for the job."
            footnote={
              canLog
                ? 'Use the form above, or the daily log to enter every job at once.'
                : 'Your role can read the work log but not add to it.'
            }
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <Table aria-label="Work entries" data-testid="work-table">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Day</TableHeaderCell>
                    <TableHeaderCell>Labor class</TableHeaderCell>
                    <TableHeaderCell numeric>Good</TableHeaderCell>
                    <TableHeaderCell numeric>Scrap</TableHeaderCell>
                    <TableHeaderCell numeric>People</TableHeaderCell>
                    <TableHeaderCell numeric>Labor hours</TableHeaderCell>
                    <TableHeaderCell numeric>
                      <span title="Good units over labor hours. Setup hours are left out.">Pace</span>
                    </TableHeaderCell>
                    {seesMoney ? <TableHeaderCell numeric>Cost of an hour</TableHeaderCell> : null}
                    {seesMoney ? <TableHeaderCell numeric>Labor cost</TableHeaderCell> : null}
                    <TableHeaderCell className="hidden xl:table-cell">By</TableHeaderCell>
                    <TableHeaderCell className="w-24">
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {days.map((day) => (
                    <TableRow
                      key={day.workDate}
                      data-testid={`work-row-${day.workDate}`}
                      data-selected={editingId === day.workDate}
                    >
                      <TableCell className="whitespace-nowrap">
                        <span className="font-medium">{dayLabel(day.workDate, today)}</span>{' '}
                        <span className="text-xs text-fg-muted">{weekdayName(day.workDate).slice(0, 3)}</span>
                        {day.notes.length > 0 ? (
                          <span className="block max-w-[220px] truncate text-xs text-fg-muted">
                            {day.notes.join(', ')}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-fg-secondary">
                        {day.rows.length > 1 ? (
                          <ul className="flex flex-col">
                            {day.rows.map((row) => (
                              <li key={row.id} className="whitespace-nowrap">
                                {lineName(day, row)}{' '}
                                <span className="text-2xs text-fg-muted tabular-nums">
                                  {formatHours(row.hours)}
                                  {row.headcount ? `, ${people(row.headcount)}` : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          crewNames(day)
                        )}
                        {day.sources.some((source) => source !== 'manual') ? (
                          <span className="block text-2xs text-fg-muted">
                            {day.sources.map((source) => SOURCE_WORDS[source] ?? source).join(', ')}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell numeric>{formatNumber(day.unitsGood, { maxDigits: 0 })}</TableCell>
                      <TableCell numeric>
                        {Number(day.unitsScrap) > 0 ? formatNumber(day.unitsScrap, { maxDigits: 0 }) : ''}
                      </TableCell>
                      <TableCell numeric>{formatNumber(day.headcount, { empty: '' })}</TableCell>
                      <TableCell numeric>
                        {day.hoursConfirmed ? (
                          <>
                            {formatHours(day.hours)}
                            {Number(day.setupHours) > 0 || Number(day.overtimeHours) > 0 ? (
                              <span className="block text-2xs text-fg-muted">
                                {[
                                  Number(day.setupHours) > 0 ? `${formatHours(day.setupHours)} setup` : null,
                                  Number(day.overtimeHours) > 0
                                    ? `${formatHours(day.overtimeHours)} overtime`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(', ')}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="rounded-sm bg-[var(--label-yellow-subtle)] px-1.5 py-0.5 text-xs font-medium text-[var(--label-yellow-text)]">
                            Add hours
                          </span>
                        )}
                      </TableCell>
                      <TableCell numeric>
                        {formatPace(day.pace, { empty: '' })}
                        {day.pace !== null && Number(day.setupHours) > 0 ? (
                          <span className="block text-2xs text-fg-muted">without setup</span>
                        ) : null}
                      </TableCell>
                      {seesMoney ? (
                        <TableCell numeric>
                          {day.needsRate ? (
                            <span className="text-[var(--label-yellow-text)]">No rate</span>
                          ) : (
                            <span
                              title={
                                day.rows.length > 1
                                  ? 'Blended across the labor types: labor cost over labor hours'
                                  : undefined
                              }
                            >
                              {formatMoneyPerHour(day.rateCents, { empty: '' }).replace(' an hour', '')}
                            </span>
                          )}
                        </TableCell>
                      ) : null}
                      {seesMoney ? (
                        <TableCell numeric>{formatMoney(day.laborCostCents, { empty: '' })}</TableCell>
                      ) : null}
                      <TableCell className="hidden xl:table-cell">
                        <PersonAvatar userId={day.rows[0]?.enteredBy ?? day.rows[0]?.createdBy ?? null} size="sm" />
                      </TableCell>
                      <TableCell className="pl-0 text-right whitespace-nowrap">
                        {day.locked ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-fg-muted"
                            title="This month is closed. Ask the owner to reopen it."
                          >
                            <Lock aria-hidden className="size-3.5" />
                            Closed
                          </span>
                        ) : canEdit(day) ? (
                          <span className="inline-flex gap-1.5">
                            <IconButton
                              label={`Edit the work for ${dayLabel(day.workDate, today)}`}
                              icon={<Pencil aria-hidden />}
                              size="md"
                              className="pointer-coarse:size-10"
                              onClick={() => openDay(day.workDate)}
                              data-testid={`work-edit-${day.workDate}`}
                            />
                            <IconButton
                              label={`Delete the work for ${dayLabel(day.workDate, today)}`}
                              icon={<Trash2 aria-hidden />}
                              size="md"
                              className="pointer-coarse:size-10"
                              onClick={() => setDeleting(day)}
                              data-testid={`work-delete-${day.workDate}`}
                            />
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="flex flex-col divide-y divide-border-subtle lg:hidden" data-testid="work-cards">
              {days.map((day) => (
                <li
                  key={day.workDate}
                  className={editingId === day.workDate ? 'bg-selected px-4 py-3' : 'px-4 py-3'}
                  data-testid={`work-card-${day.workDate}`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">
                        {dayLabel(day.workDate, today)}{' '}
                        <span className="text-xs font-normal text-fg-muted">
                          {weekdayName(day.workDate).slice(0, 3)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-fg-secondary tabular-nums">
                        {day.rows
                          .map(
                            (row) =>
                              `${lineName(day, row)} ${formatHours(row.hours)}${row.headcount ? `, ${people(row.headcount)}` : ''}`,
                          )
                          .join(' · ')}
                      </p>
                      {day.notes.length > 0 ? (
                        <p className="mt-0.5 text-xs text-fg-muted">{day.notes.join(', ')}</p>
                      ) : null}
                    </div>
                    {day.locked ? (
                      <Lock aria-label="This month is closed" className="mt-1 size-4 text-fg-muted" />
                    ) : canEdit(day) ? (
                      <div className="flex shrink-0 gap-1.5">
                        <IconButton
                          label={`Edit the work for ${dayLabel(day.workDate, today)}`}
                          icon={<Pencil aria-hidden />}
                          size="lg"
                          variant="outline"
                          onClick={() => openDay(day.workDate)}
                          data-testid={`work-card-edit-${day.workDate}`}
                        />
                        <IconButton
                          label={`Delete the work for ${dayLabel(day.workDate, today)}`}
                          icon={<Trash2 aria-hidden />}
                          size="lg"
                          variant="outline"
                          onClick={() => setDeleting(day)}
                          data-testid={`work-card-delete-${day.workDate}`}
                        />
                      </div>
                    ) : null}
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 text-sm tabular-nums sm:grid-cols-6">
                    <div>
                      <dt className="text-2xs text-fg-muted">Good</dt>
                      <dd className="font-medium text-fg">{formatNumber(day.unitsGood, { maxDigits: 0 })}</dd>
                    </div>
                    <div>
                      <dt className="text-2xs text-fg-muted">Scrap</dt>
                      <dd>{formatNumber(day.unitsScrap, { maxDigits: 0 })}</dd>
                    </div>
                    <div>
                      <dt className="text-2xs text-fg-muted">People</dt>
                      <dd>{formatNumber(day.headcount, { empty: 'Not typed' })}</dd>
                    </div>
                    <div>
                      <dt className="text-2xs text-fg-muted">Labor hours</dt>
                      <dd>{day.hoursConfirmed ? formatHours(day.hours) : 'Hours missing'}</dd>
                    </div>
                    <div>
                      <dt className="text-2xs text-fg-muted">
                        Pace{day.pace !== null && Number(day.setupHours) > 0 ? ', without setup' : ''}
                      </dt>
                      <dd>{formatPace(day.pace, { empty: 'No pace yet' })}</dd>
                    </div>
                    {seesMoney ? (
                      <div>
                        <dt className="text-2xs text-fg-muted">Labor cost</dt>
                        <dd className="font-medium text-fg">
                          {day.needsRate ? 'No rate' : formatMoney(day.laborCostCents, { empty: 'None' })}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={deleting ? `Delete the work for ${dayLabel(deleting.workDate, today)}?` : 'Delete this day?'}
        description={
          deleting ? (
            <span data-testid="work-delete-words">
              This takes the whole day off the job:{' '}
              {[
                `${formatNumber(deleting.unitsGood, { maxDigits: 0 })} good ${job.unitLabel}`,
                Number(deleting.unitsScrap) > 0 ? `${formatNumber(deleting.unitsScrap, { maxDigits: 0 })} scrapped` : null,
                `${formatHours(deleting.hours)} labor hours`,
                seesMoney && deleting.laborCostCents !== null ? `${formatMoney(deleting.laborCostCents)} of labor cost` : null,
              ]
                .filter(Boolean)
                .join(', ')}
              . Labor classes:{' '}
              {deleting.rows.map((row) => laborLineWords(row, className(row.laborClassId), hasShifts(deleting.rows), (hours) => formatHours(hours))).join('; ')}. You
              can undo it right after. Later, find it under Log work, All entries, Removed.
            </span>
          ) : undefined
        }
        confirmLabel="Delete the day"
        destructive
        onConfirm={() => {
          const day = deleting;
          setDeleting(null);
          if (day) remove(day);
        }}
      />
    </div>
  );
}
