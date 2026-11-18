'use client';
/**
 * Many days at once: a small spreadsheet for catching up. One row is one job on one day. Fill a
 * run of days for a job, paste rows from a spreadsheet, then save everything in one go. The save
 * is all or nothing and can be undone.
 */
import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { AlertTriangle, CalendarRange, ClipboardPaste, Copy, Plus, Save, Trash2 } from 'lucide-react';
import { Badge, Button, IconButton, IsoDatePicker, Skeleton, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { parseDate } from '@/lib/csv';
import { formatHours, formatNumber, formatPace } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { useJobs, useProduction, useSettings } from '@/lib/hooks/use-data';
import { addDays, isWorkDay, productivityBp, shortDate, unitsPerHour, weekdayName } from '@/lib/profit';
import { qk } from '@/lib/query-keys';
import type { ProductionEntryDTO } from '@/lib/types';
import { deleteProductionEntriesAction, saveProductionBulkAction } from '@/server/actions/log';
import {
  EMPTY_VALUES,
  applyField,
  isBlank,
  isBlockPaste,
  lineProblem,
  paceTone,
  parsePasted,
  parseTyped,
  tidy,
  toPayload,
  valuesFromEntry,
  type LineField,
  type LineValues,
  type PaceThresholds,
} from './log-math';

interface BulkRow {
  readonly key: string;
  date: string;
  jobId: string;
  values: LineValues;
}

const FIELDS: readonly LineField[] = ['unitsGood', 'unitsScrap', 'people', 'hoursEach', 'hours', 'note'];
const LABELS: Readonly<Record<string, string>> = {
  unitsGood: 'Units good',
  unitsScrap: 'Scrap',
  people: 'People',
  hoursEach: 'Hours each',
  hours: 'Labor hours',
  note: 'Note',
};
const INVALIDATE = [qk.streams(), qk.jobsRoot(), qk.profitRoot(), qk.summaryRoot(), qk.badges()] as const;

let seq = 0;
const newRow = (date: string, jobId = '', values: Partial<LineValues> = {}): BulkRow => ({
  key: `bulk-${(seq += 1)}`,
  date,
  jobId,
  values: { ...EMPTY_VALUES, ...values },
});

const cell =
  'h-10 w-full min-w-0 rounded-md border border-border-input bg-panel px-2 text-sm tabular-nums text-fg placeholder:text-fg-placeholder hover:border-border-input-hover focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus lg:h-8';

const COLS = 'lg:grid-cols-[138px_minmax(150px,1fr)_84px_64px_64px_76px_84px_minmax(90px,150px)_minmax(72px,150px)_64px]';

export function BulkView({
  today,
  thresholds,
}: {
  readonly today: string;
  readonly thresholds: PaceThresholds;
}) {
  const jobs = useJobs({ tab: 'open', limit: 500 });
  const settings = useSettings();
  const [rows, setRows] = useState<BulkRow[]>(() => [newRow(today)]);
  const [fillJob, setFillJob] = useState('');
  const [fillFrom, setFillFrom] = useState(addDays(today, -4));
  const [fillTo, setFillTo] = useState(today);
  const container = useRef<HTMLDivElement>(null);
  const jobList = useMemo(
    () =>
      [...(jobs.data ?? [])].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
    [jobs.data],
  );
  const jobById = useMemo(() => new Map(jobList.map((job) => [job.id, job])), [jobList]);
  const jobByNumber = useMemo(
    () => new Map(jobList.map((job) => [job.number.toLowerCase(), job])),
    [jobList],
  );
  const dates = rows.map((row) => row.date).sort();
  const existing = useProduction(
    { from: dates[0] ?? today, to: dates[dates.length - 1] ?? today, limit: 5000 },
    { enabled: rows.some((row) => row.jobId) },
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = useServerAction(saveProductionBulkAction, {
    invalidate: INVALIDATE,
    silentError: true,
    onError: (problem) => setSaveError(`Nothing was saved. ${problem.message}`),
  });
  const workingDays = settings.data?.workingDays;

  /** The entry a row would land on: same job, day, day shift and the job's own labor class. */
  const match = (row: BulkRow): ProductionEntryDTO | undefined => {
    const job = jobById.get(row.jobId);
    if (!job) return undefined;
    return (existing.data ?? []).find(
      (entry) =>
        entry.jobId === row.jobId &&
        entry.workDate === row.date &&
        entry.shift === 'day' &&
        entry.laborClassId === (job.defaultLaborClassId ?? null) &&
        !entry.deletedAt,
    );
  };

  const filled = rows.filter((row) => row.jobId && !isBlank(row.values));
  const problems = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.jobId && isBlank(row.values)) continue;
    if (!row.jobId) problems.set(row.key, 'Pick a job for this row.');
    else if (isBlank(row.values))
      problems.set(row.key, 'Type units, or people and hours. Or remove the row.');
    else if (lineProblem(row.values)) problems.set(row.key, lineProblem(row.values)!);
    else if (seen.has(`${row.jobId}:${row.date}`))
      problems.set(row.key, 'This job already has a row for this day above. Add the numbers together.');
    else if (row.date > today) problems.set(row.key, 'This day is in the future.');
    seen.add(`${row.jobId}:${row.date}`);
  }
  const replaces = filled.filter((row) => match(row)).length;

  const change = (key: string, patch: Partial<BulkRow>) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const setField = (key: string, field: LineField, text: string) =>
    setRows((previous) =>
      previous.map((row) =>
        row.key === key ? { ...row, values: applyField(row.values, field, text) } : row,
      ),
    );

  function focus(key: string, field: string) {
    const el = container.current?.querySelector<HTMLInputElement>(
      `[data-row="${key}"][data-field="${field}"]`,
    );
    el?.focus();
    el?.select?.();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, key: string, field: LineField) {
    const index = rows.findIndex((row) => row.key === key);
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = rows[index + 1];
      if (next) focus(next.key, field);
      else if (event.key === 'Enter') {
        const row = rows[index]!;
        const added = newRow(nextDay(row.date), row.jobId);
        setRows((previous) => [...previous, added]);
        setTimeout(() => focus(added.key, field), 30);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const previous = rows[index - 1];
      if (previous) focus(previous.key, field);
    }
  }

  const nextDay = (date: string): string => {
    let next = addDays(date, 1);
    for (let guard = 0; guard < 7 && !isWorkDay(next, workingDays); guard += 1) next = addDays(next, 1);
    return next > today ? today : next;
  };

  function duplicate(row: BulkRow) {
    const copy = newRow(nextDay(row.date), row.jobId, row.values);
    setRows((previous) => {
      const index = previous.findIndex((item) => item.key === row.key);
      return [...previous.slice(0, index + 1), copy, ...previous.slice(index + 1)];
    });
    setTimeout(() => focus(copy.key, 'unitsGood'), 30);
  }

  function fillRun() {
    const job = jobById.get(fillJob);
    if (!job) {
      toast.warning('Pick a job first', 'Then Pulse adds one row for each work day in the range.');
      return;
    }
    if (fillTo < fillFrom) return;
    const added: BulkRow[] = [];
    const crew = job.usualCrew.reduce((total, line) => total + Number(line.headcount ?? 0), 0);
    for (let day = fillFrom; day <= fillTo && added.length < 62; day = addDays(day, 1)) {
      if (!isWorkDay(day, workingDays)) continue;
      if (rows.some((row) => row.jobId === job.id && row.date === day)) continue;
      const entry = (existing.data ?? []).find(
        (item) =>
          item.jobId === job.id &&
          item.workDate === day &&
          item.shift === 'day' &&
          item.laborClassId === (job.defaultLaborClassId ?? null) &&
          !item.deletedAt,
      );
      added.push(
        newRow(
          day,
          job.id,
          entry
            ? valuesFromEntry(entry)
            : crew > 0
              ? applyField(
                  applyField(EMPTY_VALUES, 'people', tidy(crew)),
                  'hoursEach',
                  tidy(settings.data?.defaultShiftHours ?? '8'),
                )
              : {},
        ),
      );
    }
    if (added.length === 0) {
      toast.info('No days to add', 'Those days are already on the sheet, or the range has no work days.');
      return;
    }
    setRows((previous) => [...previous.filter((row) => row.jobId || !isBlank(row.values)), ...added]);
    setTimeout(() => focus(added[0]!.key, 'unitsGood'), 30);
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>, key: string, field: LineField) {
    const text = event.clipboardData.getData('text/plain');
    if (!isBlockPaste(text)) return;
    event.preventDefault();
    const block = parsePasted(text);
    const start = rows.findIndex((row) => row.key === key);
    const startCol = FIELDS.indexOf(field);
    // A block whose first column is a day and second a job number makes new rows.
    const asRows = block.filter(
      (cells) => parseDate(cells[0] ?? '').ok && jobByNumber.has((cells[1] ?? '').toLowerCase()),
    );
    // Rows that start with a day or name a job are meant as new rows, even when some of them cannot be used.
    const meantAsRows = block.filter(
      (cells) => parseDate(cells[0] ?? '').ok || jobByNumber.has((cells[1] ?? '').toLowerCase()),
    );
    if (meantAsRows.length > 0 && meantAsRows.length >= block.length - 1 && block.some((cells) => cells.length > 2)) {
      const leftOut: string[] = [];
      block.forEach((cells, index) => {
        if (asRows.includes(cells)) return;
        const day = cells[0] ?? '';
        const number = cells[1] ?? '';
        // A header row ("Day, Job, Units") is not a miss.
        if (index === 0 && !parseDate(day).ok && !jobByNumber.has(number.toLowerCase())) return;
        leftOut.push(
          !parseDate(day).ok
            ? `"${day}" is not a day`
            : `"${number}" is not a job you can log to`,
        );
      });
      if (asRows.length === 0) {
        toast.warning('Nothing was pasted', `${leftOut.slice(0, 3).join('. ')}.`);
        return;
      }
      const added = asRows.map((cells) => {
        const parsed = parseDate(cells[0] ?? '');
        const job = jobByNumber.get((cells[1] ?? '').toLowerCase())!;
        let values: LineValues = EMPTY_VALUES;
        (['unitsGood', 'unitsScrap', 'people', 'hoursEach', 'hours', 'note'] as const).forEach(
          (name, index) => {
            const value = cells[2 + index] ?? '';
            if (value !== '')
              values = applyField(values, name, name === 'note' ? value : value.replace(/[$,\s]/g, ''));
          },
        );
        return newRow(parsed.ok ? String(parsed.value) : today, job.id, values);
      });
      setRows((previous) => [...previous.filter((row) => row.jobId || !isBlank(row.values)), ...added]);
      if (leftOut.length > 0)
        toast.warning(
          `Pasted ${added.length} ${added.length === 1 ? 'row' : 'rows'}, left out ${leftOut.length}`,
          `${leftOut.slice(0, 3).join('. ')}${leftOut.length > 3 ? `, and ${leftOut.length - 3} more` : ''}.`,
        );
      else
        toast.success(
          `Pasted ${added.length} ${added.length === 1 ? 'row' : 'rows'}`,
          block.length > asRows.length ? 'The header row was left out.' : undefined,
        );
      return;
    }
    setRows((previous) => {
      const next = [...previous];
      block.forEach((cells, r) => {
        let row = next[start + r];
        if (!row) {
          const last = next[next.length - 1]!;
          row = newRow(nextDay(last.date), last.jobId);
          next.push(row);
        }
        let values = row.values;
        cells.forEach((value, c) => {
          const name = FIELDS[startCol + c];
          if (name && value !== '')
            values = applyField(values, name, name === 'note' ? value : value.replace(/[$,\s]/g, ''));
        });
        next[next.indexOf(row)] = { ...row, values };
      });
      return next;
    });
  }

  async function saveAll() {
    setSaveError(null);
    if (problems.size > 0) {
      setSaveError(
        `${problems.size} ${problems.size === 1 ? 'row needs' : 'rows need'} a fix before anything is saved.`,
      );
      return;
    }
    if (filled.length === 0) {
      setSaveError('There is nothing to save yet. Pick a job and type units, people and hours.');
      return;
    }
    const before = filled.map((row) => ({ row, entry: match(row) }));
    const result = await save.run({
      entries: before.map(({ row, entry }) => ({
        id: entry?.id ?? null,
        jobId: row.jobId,
        workDate: row.date,
        shift: 'day',
        version: entry?.version ?? null,
        ...toPayload({
          ...row.values,
          laborClassId: jobById.get(row.jobId)?.defaultLaborClassId ?? null,
          setup: entry ? tidy(entry.setupHours) : '',
          overtime: entry ? tidy(entry.overtimeHours) : '',
        }),
      })),
    });
    if (!result) return;
    const kept = rows.filter((row) => !filled.includes(row));
    setRows(kept.length > 0 ? kept : [newRow(today)]);
    const saved = result.entries;
    toast.undo(
      `Saved ${filled.length} ${filled.length === 1 ? 'row' : 'rows'}: ${result.created} new, ${result.updated} changed`,
      {
        onUndo: async () => {
          const created = before
            .map((item, index) => ({ ...item, saved: saved[index] }))
            .filter((item) => !item.entry && item.saved);
          const edited = before
            .map((item, index) => ({ ...item, saved: saved[index] }))
            .filter((item) => item.entry && item.saved);
          if (created.length > 0) {
            const gone = await deleteProductionEntriesAction({ ids: created.map((item) => item.saved!.id) });
            if (!gone.ok) throw new Error(gone.error.message);
          }
          if (edited.length > 0) {
            const back = await saveProductionBulkAction({
              entries: edited.map((item) => ({
                id: item.entry!.id,
                jobId: item.entry!.jobId,
                workDate: item.entry!.workDate,
                version: item.saved!.version,
                ...toPayload(valuesFromEntry(item.entry!)),
              })),
            });
            if (!back.ok) throw new Error(back.error.message);
          }
          setRows((previous) => [...previous.filter((row) => row.jobId || !isBlank(row.values)), ...filled]);
          await existing.refetch();
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="bulk-view">
      <Panel>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-72">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-fg">
              <CalendarRange aria-hidden className="size-4 text-icon" /> Fill a run of days for one job
            </h2>
            <p className="text-sm text-fg-muted">
              Pick a job and the days. Pulse adds one row for each work day, with the usual crew filled in.
              Days that are already logged come in with their numbers.
            </p>
          </div>
          <label className="flex min-w-0 basis-64 flex-col gap-1 text-xs text-fg-muted">
            Job
            <select
              className={cn(cell, 'cursor-pointer')}
              value={fillJob}
              onChange={(event) => setFillJob(event.target.value)}
              aria-label="Job to fill"
            >
              <option value="">{jobs.isLoading ? 'Loading jobs' : 'Pick a job'}</option>
              {jobList.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.number} {job.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            From
            <IsoDatePicker
              value={fillFrom}
              onChange={(value) => value && setFillFrom(value)}
              clearable={false}
              aria-label="First day"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            To
            <IsoDatePicker
              value={fillTo}
              onChange={(value) => value && setFillTo(value > today ? today : value)}
              clearable={false}
              aria-label="Last day"
            />
          </label>
          <Button variant="secondary" leadingIcon={<Plus aria-hidden />} onClick={fillRun}>
            Add the days
          </Button>
        </div>
      </Panel>

      <Panel bodyClassName="p-0">
        <div ref={container}>
          <div
            aria-hidden
            className={cn(
              'hidden items-end gap-1 border-b border-border-default px-3 py-2 text-xs font-medium text-fg-muted lg:grid',
              COLS,
            )}
          >
            <span>Day</span>
            <span>Job</span>
            <span className="pr-2 text-right">Units good</span>
            <span className="pr-2 text-right">Scrap</span>
            <span className="pr-2 text-right">People</span>
            <span className="pr-2 text-right">Hours each</span>
            <span className="pr-2 text-right">Labor hours</span>
            <span className="pl-2">Note</span>
            <span>Check</span>
            <span />
          </div>
          {jobs.isLoading ? (
            <div className="flex flex-col gap-2 p-4" aria-busy="true">
              <Skeleton height={32} className="w-full" />
              <Skeleton height={32} className="w-full" />
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((row) => {
                const job = jobById.get(row.jobId);
                const entry = match(row);
                const problem = problems.get(row.key);
                const pace = unitsPerHour(
                  parseTyped(row.values.unitsGood) ?? 0,
                  parseTyped(row.values.hours) ?? 0,
                );
                const target = job?.stats.standardUph ?? job?.standardUph ?? null;
                const tone = paceTone(pace === null ? null : productivityBp(pace, target), thresholds);
                const input = (field: LineField, text = false) => (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs text-fg-muted lg:sr-only">{LABELS[field]}</span>
                    <input
                      data-row={row.key}
                      data-field={field}
                      aria-label={`${LABELS[field]} for ${job?.number ?? 'the new row'} on ${shortDate(row.date)}`}
                      inputMode={text ? 'text' : 'decimal'}
                      value={row.values[field]}
                      onChange={(event) => setField(row.key, field, event.target.value)}
                      onKeyDown={(event) => onKeyDown(event, row.key, field)}
                      onPaste={(event) => onPaste(event, row.key, field)}
                      onFocus={(event) => event.currentTarget.select()}
                      className={cn(cell, !text && 'text-right')}
                    />
                  </label>
                );
                return (
                  <li
                    key={row.key}
                    data-testid="bulk-row"
                    className={cn(
                      'grid grid-cols-2 gap-2 px-3 py-3 sm:grid-cols-4 lg:items-center lg:gap-1 lg:py-1.5',
                      COLS,
                    )}
                  >
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-xs text-fg-muted lg:sr-only">Day</span>
                      <input
                        type="date"
                        aria-label="Day"
                        max={today}
                        value={row.date}
                        onChange={(event) =>
                          event.target.value && change(row.key, { date: event.target.value })
                        }
                        className={cell}
                      />
                    </label>
                    <label className="col-span-1 flex min-w-0 flex-col gap-1 sm:col-span-3 lg:col-span-1">
                      <span className="text-xs text-fg-muted lg:sr-only">Job</span>
                      <select
                        aria-label={`Job for the row on ${shortDate(row.date)}`}
                        value={row.jobId}
                        onChange={(event) => change(row.key, { jobId: event.target.value })}
                        className={cn(cell, 'cursor-pointer truncate')}
                      >
                        <option value="">Pick a job</option>
                        {jobList.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.number} {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {input('unitsGood')}
                    {input('unitsScrap')}
                    {input('people')}
                    {input('hoursEach')}
                    {input('hours')}
                    <div className="col-span-2 sm:col-span-3 lg:col-span-1">{input('note', true)}</div>
                    <div className="col-span-full flex min-w-0 flex-wrap items-center gap-1.5 text-xs lg:col-span-1">
                      {problem ? (
                        <span role="alert" className="flex items-start gap-1 text-danger-text">
                          <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" /> {problem}
                        </span>
                      ) : (
                        <>
                          <span className="text-fg-muted">{weekdayName(row.date).slice(0, 3)}</span>
                          {entry ? (
                            <Badge tone="warning" size="sm">
                              Replaces what is logged
                            </Badge>
                          ) : row.jobId && !isBlank(row.values) ? (
                            <Badge tone="success" size="sm">
                              New
                            </Badge>
                          ) : null}
                          {pace !== null ? (
                            <span
                              className={cn(
                                'tabular-nums',
                                tone === 'bad'
                                  ? 'text-danger-text'
                                  : tone === 'watch'
                                    ? 'text-warning-text'
                                    : tone === 'good'
                                      ? 'text-success-text'
                                      : 'text-fg-secondary',
                              )}
                            >
                              {formatPace(pace)}
                              {target ? ` of ${formatPace(target)}` : ''} an hour
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                    <div className="col-span-full flex items-center justify-end gap-0.5 lg:col-span-1">
                      <IconButton
                        label="Duplicate this row for the next work day"
                        icon={<Copy aria-hidden />}
                        size="sm"
                        variant="ghost"
                        onClick={() => duplicate(row)}
                      />
                      <IconButton
                        label="Remove this row from the sheet"
                        icon={<Trash2 aria-hidden />}
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setRows((previous) =>
                            previous.length > 1
                              ? previous.filter((item) => item.key !== row.key)
                              : [newRow(today)],
                          )
                        }
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border-default bg-sunken px-4 py-3">
          <Button
            variant="secondary"
            leadingIcon={<Plus aria-hidden />}
            onClick={() =>
              setRows((previous) => [
                ...previous,
                newRow(
                  previous[previous.length - 1]?.date ?? today,
                  previous[previous.length - 1]?.jobId ?? '',
                ),
              ])
            }
          >
            Add a row
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-fg-muted">
            <ClipboardPaste aria-hidden className="size-3.5" /> Paste rows from a spreadsheet: day, job
            number, units, scrap, people, hours each, labor hours, note.
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <span className="text-sm text-fg-secondary" aria-live="polite">
              {filled.length} {filled.length === 1 ? 'row' : 'rows'} to save
              {filled.length > 0
                ? `, ${formatNumber(
                    filled.reduce((sum, row) => sum + (parseTyped(row.values.unitsGood) ?? 0), 0),
                    { maxDigits: 0 },
                  )} units, ${formatHours(filled.reduce((sum, row) => sum + (parseTyped(row.values.hours) ?? 0), 0))} labor hours`
                : ''}
              {replaces > 0 ? `. ${replaces} will replace what is logged` : ''}
            </span>
            <Button
              leadingIcon={<Save aria-hidden />}
              onClick={() => void saveAll()}
              loading={save.pending}
              disabled={filled.length === 0}
            >
              Save all rows
            </Button>
          </div>
          {saveError ? (
            <p role="alert" className="basis-full text-sm text-danger-text">
              {saveError}
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
