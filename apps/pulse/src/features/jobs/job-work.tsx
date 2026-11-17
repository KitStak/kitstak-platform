'use client';
/**
 * Work log: every day of work on this job, with add and edit in place, delete with undo, the
 * daily units and pace against the target, and a CSV export.
 */
import { useMemo, useState } from 'react';
import { ClipboardPen, Download, Lock, Pencil, Trash2 } from 'lucide-react';
import {
  Button,
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
import type { ProductionEntryDTO } from '@/lib/types';
import { deleteProductionEntriesAction, restoreProductionEntriesAction } from '@/server/actions/log';
import { WorkEntryForm } from './forms/work-entry-form';
import { useDeleteWithUndo, useJobProduction, useRefreshJob } from './job-data';
import { rowPace, shiftDate, singularUnit } from './job-math';
import type { JobTabProps } from './job-overview';
import { Explain, LoadError } from './job-ui';

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

export function JobWork({ job, today, laborClasses }: JobTabProps) {
  const shell = useShell();
  const refresh = useRefreshJob();
  const removeWithUndo = useDeleteWithUndo(refresh);
  const production = useJobProduction(job.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const unit = singularUnit(job.unitLabel);
  const seesMoney = shell.seesMoney && !job.stats.moneyHidden;
  const canLog = shell.can('production:log');
  const canEditAny = shell.can('production:edit_any');
  const classNames = useMemo(() => new Map(laborClasses.map((item) => [item.id, item.name])), [laborClasses]);
  const oldest = shiftDate(today, -SUPERVISOR_EDIT_DAYS);
  const canEdit = (row: ProductionEntryDTO) =>
    canLog && !row.locked && (canEditAny || row.workDate >= oldest);
  const jobOpen = job.status === 'active' || job.status === 'on_hold' || job.status === 'planned';

  const rows = useMemo(
    () => (production.data ?? []).filter((row) => row.deletedAt === null && !hidden.has(row.id)),
    [production.data, hidden],
  );

  const editingRow = rows.find((row) => row.id === editingId) ?? null;

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
      'Crew',
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

  const remove = (row: ProductionEntryDTO) =>
    void removeWithUndo({
      label: `the entry for ${shortDate(row.workDate)}`,
      hide: () => setHidden((current) => new Set(current).add(row.id)),
      show: () =>
        setHidden((current) => {
          const next = new Set(current);
          next.delete(row.id);
          return next;
        }),
      remove: () => deleteProductionEntriesAction({ ids: [row.id] }),
      restore: () => restoreProductionEntriesAction({ ids: [row.id] }),
    });

  const saved = async (created: boolean, editing: boolean) => {
    setEditingId(null);
    await refresh();
    toast.success(
      editing
        ? 'Entry saved'
        : created
          ? 'Day added'
          : 'That day already had an entry for this crew, so it was updated',
    );
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
          value={formatNumber(job.stats.unitsGood, { maxDigits: 0 })}
          footer={
            <span className="text-xs text-fg-muted">
              {formatNumber(job.stats.unitsScrap, { maxDigits: 0 })} scrapped
            </span>
          }
        />
        <KpiTile
          label="Labor hours"
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
            value={formatNumber(chart.labels.length)}
            footer={
              <span className="text-xs text-fg-muted">
                {job.stats.lastEntryDate ? `last on ${shortDate(job.stats.lastEntryDate)}` : 'none yet'}
              </span>
            }
          />
        )}
      </div>

      {canLog && jobOpen ? (
        <Panel
          title="Add a day of work"
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
          <WorkEntryForm
            jobId={job.id}
            unit={job.unitLabel}
            today={today}
            laborClasses={laborClasses}
            defaultLaborClassId={job.defaultLaborClassId}
            onSaved={(created) => saved(created, false)}
          />
        </Panel>
      ) : !jobOpen ? (
        <p className="rounded-xl border border-border-subtle bg-panel px-4 py-3 text-sm text-fg-secondary">
          This job is {job.status === 'completed' ? 'complete' : 'cancelled'}, so no new days can be added.
          Reopen it from the stage menu to log more work.
        </p>
      ) : null}

      {rows.length > 0 ? (
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
            {editingRow ? (
              <div className="border-b border-border-subtle bg-sunken p-4">
                <p className="mb-2 text-sm font-medium text-fg">
                  Editing the entry for {shortDate(editingRow.workDate)}
                </p>
                <WorkEntryForm
                  key={editingRow.id}
                  jobId={job.id}
                  unit={job.unitLabel}
                  row={editingRow}
                  today={today}
                  laborClasses={laborClasses}
                  defaultLaborClassId={job.defaultLaborClassId}
                  onSaved={(created) => saved(created, true)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : null}
            <div className="hidden overflow-x-auto md:block">
              <Table aria-label="Work entries" data-testid="work-table">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Day</TableHeaderCell>
                    <TableHeaderCell>Crew</TableHeaderCell>
                    <TableHeaderCell numeric>Good</TableHeaderCell>
                    <TableHeaderCell numeric>Scrap</TableHeaderCell>
                    <TableHeaderCell numeric>People</TableHeaderCell>
                    <TableHeaderCell numeric>Labor hours</TableHeaderCell>
                    <TableHeaderCell numeric>Pace</TableHeaderCell>
                    {seesMoney ? <TableHeaderCell numeric>Cost of an hour</TableHeaderCell> : null}
                    {seesMoney ? <TableHeaderCell numeric>Labor cost</TableHeaderCell> : null}
                    <TableHeaderCell>By</TableHeaderCell>
                    <TableHeaderCell className="w-20">
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-testid={`work-row-${row.workDate}`}
                      data-selected={editingId === row.id}
                    >
                      <TableCell className="whitespace-nowrap">
                        <span className="font-medium">{shortDate(row.workDate)}</span>{' '}
                        <span className="text-xs text-fg-muted">{weekdayName(row.workDate).slice(0, 3)}</span>
                        {row.note ? (
                          <span className="block max-w-[220px] truncate text-xs text-fg-muted">
                            {row.note}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-fg-secondary">
                        {row.laborClassId ? (classNames.get(row.laborClassId) ?? 'Crew') : 'Not set'}
                        {row.source !== 'manual' ? (
                          <span className="block text-2xs text-fg-muted">
                            {SOURCE_WORDS[row.source] ?? row.source}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell numeric>{formatNumber(row.unitsGood, { maxDigits: 0 })}</TableCell>
                      <TableCell numeric>
                        {Number(row.unitsScrap) > 0 ? formatNumber(row.unitsScrap, { maxDigits: 0 }) : ''}
                      </TableCell>
                      <TableCell numeric>{formatNumber(row.headcount, { empty: '' })}</TableCell>
                      <TableCell numeric>
                        {row.hoursConfirmed ? (
                          <>
                            {formatHours(row.hours)}
                            {Number(row.setupHours) > 0 || Number(row.overtimeHours) > 0 ? (
                              <span className="block text-2xs text-fg-muted">
                                {[
                                  Number(row.setupHours) > 0 ? `${formatHours(row.setupHours)} setup` : null,
                                  Number(row.overtimeHours) > 0
                                    ? `${formatHours(row.overtimeHours)} overtime`
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
                      <TableCell numeric>{formatPace(rowPace(row), { empty: '' })}</TableCell>
                      {seesMoney ? (
                        <TableCell numeric>
                          {row.needsRate ? (
                            <span className="text-[var(--label-yellow-text)]">No rate</span>
                          ) : (
                            formatMoneyPerHour(row.rateCents, { empty: '' }).replace(' an hour', '')
                          )}
                        </TableCell>
                      ) : null}
                      {seesMoney ? (
                        <TableCell numeric>{formatMoney(row.laborCostCents, { empty: '' })}</TableCell>
                      ) : null}
                      <TableCell>
                        <PersonAvatar userId={row.enteredBy ?? row.createdBy} size="sm" />
                      </TableCell>
                      <TableCell className="pl-0 text-right whitespace-nowrap">
                        {row.locked ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-fg-muted"
                            title="This month is closed. Ask the owner to reopen it."
                          >
                            <Lock aria-hidden className="size-3.5" />
                            Closed
                          </span>
                        ) : canEdit(row) ? (
                          <>
                            <IconButton
                              label={`Edit the entry for ${shortDate(row.workDate)}`}
                              icon={<Pencil aria-hidden />}
                              size="sm"
                              onClick={() => setEditingId(row.id)}
                              data-testid={`work-edit-${row.workDate}`}
                            />
                            <IconButton
                              label={`Delete the entry for ${shortDate(row.workDate)}`}
                              icon={<Trash2 aria-hidden />}
                              size="sm"
                              onClick={() => remove(row)}
                              data-testid={`work-delete-${row.workDate}`}
                            />
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="flex flex-col divide-y divide-border-subtle md:hidden" data-testid="work-cards">
              {rows.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">
                        {shortDate(row.workDate)}{' '}
                        <span className="text-xs font-normal text-fg-muted">
                          {row.laborClassId ? classNames.get(row.laborClassId) : ''}
                        </span>
                      </p>
                      <p className="mt-0.5 text-sm text-fg-secondary tabular-nums">
                        {formatNumber(row.unitsGood, { maxDigits: 0 })} good,{' '}
                        {row.hoursConfirmed ? `${formatHours(row.hours)} labor hours` : 'hours missing'}
                        {rowPace(row) !== null ? `, pace ${formatPace(rowPace(row))}` : ''}
                        {seesMoney && row.laborCostCents !== null
                          ? `, ${formatMoney(row.laborCostCents)}`
                          : ''}
                      </p>
                      {row.note ? <p className="mt-0.5 text-xs text-fg-muted">{row.note}</p> : null}
                    </div>
                    {row.locked ? (
                      <Lock aria-label="This month is closed" className="mt-1 size-4 text-fg-muted" />
                    ) : canEdit(row) ? (
                      <div className="flex shrink-0">
                        <IconButton
                          label={`Edit the entry for ${shortDate(row.workDate)}`}
                          icon={<Pencil aria-hidden />}
                          size="sm"
                          onClick={() => setEditingId(row.id)}
                        />
                        <IconButton
                          label={`Delete the entry for ${shortDate(row.workDate)}`}
                          icon={<Trash2 aria-hidden />}
                          size="sm"
                          onClick={() => remove(row)}
                        />
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}
