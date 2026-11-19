'use client';
/** Every production entry across days: filter, fix one, change many at once, remove with undo, export. */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList,
  ClipboardPen,
  Download,
  FileSpreadsheet,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  IconButton,
  Input,
  IsoDatePicker,
  Select,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TablePagination,
  TableRow,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { useShell } from '@/features/shell/shell-context';
import { SavedViewsBar } from '@/features/views/saved-views-bar';
import { useUrlState, useUrlText } from '@/features/views/use-url-state';
import { STREAM_SOURCES, type StreamSource } from '@/lib/constants';
import { exportFileName, streamToCsv } from '@/lib/csv';
import { formatHours, formatMoney, formatNumber, formatPace } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { useProduction, useSettings } from '@/lib/hooks/use-data';
import { addDays, shortDate, weekdayName } from '@/lib/profit';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { LaborClassDTO, ProductionEntryDTO, SiteDTO } from '@/lib/types';
import {
  deleteProductionEntriesAction,
  restoreProductionEntriesAction,
  saveProductionBulkAction,
  saveProductionEntryAction,
} from '@/server/actions/log';
import { WorkEntryForm, type DaySaved } from '@/features/jobs/forms/work-entry-form';
import {
  groupJobDays,
  groupWorkDays,
  hasShifts,
  laborLineWords,
  restoreDayLines,
  saveDay,
  type JobDay,
} from '@/features/jobs/work-days';
import {
  applyField,
  hoursEachFrom,
  lineProblem,
  toPayload,
  valuesFromEntry,
  type LineValues,
} from './log-math';

const INVALIDATE = [qk.streams(), qk.jobsRoot(), qk.profitRoot(), qk.summaryRoot(), qk.badges()] as const;
const PAGE_SIZE = 50;

const SOURCE_LABELS: Readonly<Record<StreamSource, string>> = {
  manual: 'Typed',
  csv: 'Spreadsheet',
  wms: 'Warehouse',
  crm: 'CRM',
  projects: 'Projects',
  punch: 'Time punches',
  system: 'Pulse',
  sample: 'Sample data',
};

export function downloadCsv(fileName: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EntriesView({
  sites,
  laborClasses,
  today,
}: {
  readonly sites: readonly SiteDTO[];
  readonly laborClasses: readonly LaborClassDTO[];
  readonly today: string;
}) {
  const shell = useShell();
  const canLog = shell.can('production:log');
  // Every filter lives in the address bar, so a list can be shared and kept as a saved view.
  const url = useUrlState();
  const day = (value: string | null, fallback: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback);
  const from = day(url.get('from'), addDays(today, -13));
  const to = day(url.get('to'), today);
  const siteId = url.get('site') ?? 'all';
  const classId = url.get('class') ?? 'all';
  const source = url.get('source') ?? 'all';
  const needsHours = url.get('needsHours') === '1';
  const removed = url.get('removed') === '1';
  const setFrom = (value: string) => url.set({ from: value });
  const setTo = (value: string) => url.set({ to: value });
  const setSiteId = (value: string) => url.set({ site: value === 'all' ? null : value });
  const setClassId = (value: string) => url.set({ class: value === 'all' ? null : value });
  const setSource = (value: string) => url.set({ source: value === 'all' ? null : value });
  const setNeedsHours = (value: boolean) => url.set({ needsHours: value ? '1' : null });
  const setRemoved = (value: boolean) => url.set({ removed: value ? '1' : null });
  const [search, setSearch] = useUrlText('job');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ProductionEntryDTO | null>(null);
  const [editingDay, setEditingDay] = useState<JobDay | null>(null);
  const [bulkClass, setBulkClass] = useState<string | undefined>(undefined);

  const query = useProduction({
    from,
    to,
    siteId: siteId === 'all' ? null : siteId,
    laborClassId: classId === 'all' ? null : classId,
    source: source === 'all' ? null : (source as StreamSource),
    needsHours: needsHours || undefined,
    includeDeleted: removed || undefined,
    limit: 5000,
  });
  const classById = useMemo(() => new Map(laborClasses.map((item) => [item.id, item])), [laborClasses]);
  const siteById = useMemo(() => new Map(sites.map((item) => [item.id, item])), [sites]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data ?? [])
      .filter((row) => (removed ? row.deletedAt !== null : row.deletedAt === null))
      .filter((row) => !q || `${row.jobNumber} ${row.jobName} ${row.note ?? ''}`.toLowerCase().includes(q));
  }, [query.data, removed, search]);

  /** A filter change starts again at page one with nothing chosen. */
  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
      setSelected(new Set());
    };

  // One line per job per day: the labor types of a day are rolled up, and chosen together.
  const jobDays = useMemo(() => groupJobDays(rows), [rows]);
  const pageCount = Math.max(1, Math.ceil(jobDays.length / PAGE_SIZE));
  const pageDays = jobDays.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageRows = pageDays.flatMap((item) => item.day.rows);
  const chosen = rows.filter((row) => selected.has(row.id));
  const editable = chosen.filter((row) => !row.locked);
  const allOnPage = pageRows.length > 0 && pageRows.every((row) => selected.has(row.id));
  const dayChoice = (item: JobDay): boolean | 'indeterminate' => {
    const count = item.day.rows.filter((row) => selected.has(row.id)).length;
    return count === 0 ? false : count === item.day.rows.length ? true : 'indeterminate';
  };
  const dayName = (item: JobDay) => `${item.first.jobNumber} on ${shortDate(item.first.workDate)}`;
  const settings = useSettings();
  /** One words line per labor type of the day: "Machine operator, 8 hours". A one type day is just the class. */
  const crewLines = (item: JobDay): string[] => {
    const name = (row: ProductionEntryDTO) => classById.get(row.laborClassId ?? '')?.name ?? 'Default class';
    if (item.day.rows.length === 1) return [name(item.day.rows[0] as ProductionEntryDTO)];
    const shifts = hasShifts(item.day.rows);
    return item.day.rows.map((row) => laborLineWords(row, name(row), shifts, (hours) => formatHours(hours)));
  };
  const queryClient = useQueryClient();
  const refreshEntries = () =>
    Promise.all(INVALIDATE.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  const totals = useMemo(
    () => ({
      units: rows.reduce((sum, row) => sum + Number(row.unitsGood), 0),
      hours: rows.reduce((sum, row) => sum + Number(row.hours), 0),
    }),
    [rows],
  );

  const remove = useServerAction(deleteProductionEntriesAction, { invalidate: INVALIDATE });
  const restore = useServerAction(restoreProductionEntriesAction, { invalidate: INVALIDATE });
  const bulk = useServerAction(saveProductionBulkAction, { invalidate: INVALIDATE });

  function toggleDay(item: JobDay, on: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const row of item.day.rows)
        if (on) next.add(row.id);
        else next.delete(row.id);
      return next;
    });
  }

  /** Opens the one-entry dialog for a day with one labor type, the day form for a day with more. */
  function openDay(item: JobDay) {
    if (item.day.rows.length > 1 || !item.first) setEditingDay(item);
    else setEditing(item.first);
  }

  async function removeRows(targets: readonly ProductionEntryDTO[]) {
    if (targets.length === 0) return;
    const ids = targets.map((row) => row.id);
    const gone = await remove.run({ ids });
    if (!gone) return;
    setSelected(new Set());
    toast.undo(`Removed ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}`, {
      onUndo: async () => void (await restore.run({ ids })),
    });
  }

  async function restoreRows(targets: readonly ProductionEntryDTO[]) {
    const ids = targets.map((row) => row.id);
    const back = await restore.run({ ids });
    if (!back) return;
    setSelected(new Set());
    toast.undo(`Put back ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}`, {
      onUndo: async () => void (await remove.run({ ids })),
    });
  }

  async function setClassForChosen() {
    if (!bulkClass || editable.length === 0) return;
    const targets = editable.filter((row) => (row.laborClassId ?? 'none') !== bulkClass);
    if (targets.length === 0) {
      toast.info('Nothing to change', 'Every chosen entry already has that labor class.');
      return;
    }
    const before = targets.map((row) => ({
      id: row.id,
      jobId: row.jobId,
      workDate: row.workDate,
      laborClassId: row.laborClassId,
    }));
    const done = await bulk.run({
      entries: targets.map((row) => ({
        id: row.id,
        jobId: row.jobId,
        workDate: row.workDate,
        laborClassId: bulkClass === 'none' ? null : bulkClass,
        version: row.version,
      })),
    });
    if (!done) return;
    setSelected(new Set());
    toast.undo(`Changed the labor class of ${targets.length} ${targets.length === 1 ? 'entry' : 'entries'}`, {
      description: 'Labor cost was worked out again with the new real cost of an hour.',
      onUndo: async () => void (await bulk.run({ entries: before.map((row) => ({ ...row })) })),
    });
  }

  function exportRows(list: readonly ProductionEntryDTO[]) {
    if (list.length === 0) return;
    const records = list.map((row) => ({
      entryId: row.id,
      workDate: row.workDate,
      jobNumber: row.jobNumber,
      shift: row.shift,
      laborClass: classById.get(row.laborClassId ?? '')?.code ?? '',
      unitsGood: row.unitsGood,
      unitsScrap: row.unitsScrap,
      unitsRework: row.unitsRework,
      people: row.headcount ?? '',
      hoursEach: hoursEachFrom(row.hours, row.headcount),
      laborHours: row.hours,
      overtimeHours: row.overtimeHours,
      setupHours: row.setupHours,
      note: row.note ?? '',
    }));
    downloadCsv(exportFileName('production', shell.org.slug, from, to), streamToCsv('production', records));
    toast.success(
      `Exported ${list.length} ${list.length === 1 ? 'entry' : 'entries'}`,
      'The file can be changed in a spreadsheet and imported back.',
    );
  }

  const classOptions = [
    { value: 'all', label: 'All labor classes' },
    ...laborClasses.filter((item) => !item.archivedAt).map((item) => ({ value: item.id, label: item.name })),
  ];
  const hasFilters =
    siteId !== 'all' ||
    classId !== 'all' ||
    source !== 'all' ||
    needsHours ||
    removed ||
    search.trim() !== '';

  return (
    <div className="flex flex-col gap-4" data-testid="entries-view">
      <SavedViewsBar page="log" />
      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-end gap-2 border-b border-border-subtle px-3 py-2.5">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            From
            <IsoDatePicker
              value={from}
              onChange={(value) => value && filter(setFrom)(value > to ? to : value)}
              aria-label="From day"
              clearable={false}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            To
            <IsoDatePicker
              value={to}
              onChange={(value) => value && filter(setTo)(value < from ? from : value)}
              aria-label="To day"
              clearable={false}
            />
          </label>
          {sites.length > 1 ? (
            <Select
              aria-label="Site"
              className="w-48"
              value={siteId}
              onValueChange={filter(setSiteId)}
              options={[
                { value: 'all', label: 'All sites' },
                ...sites.map((site) => ({ value: site.id, label: site.name })),
              ]}
            />
          ) : null}
          <Select
            aria-label="Labor class"
            className="w-44"
            value={classId}
            onValueChange={filter(setClassId)}
            options={classOptions}
          />
          <Select
            aria-label="Where the entry came from"
            className="w-40"
            value={source}
            onValueChange={filter(setSource)}
            options={[
              { value: 'all', label: 'Any source' },
              ...STREAM_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] })),
            ]}
          />
          <div className="w-full sm:w-52">
            <Input
              leadingIcon={<Search aria-hidden />}
              value={search}
              onChange={(event) => filter(setSearch)(event.target.value)}
              placeholder="Job or note"
              aria-label="Search job or note"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1">
            <Switch
              checked={needsHours}
              onCheckedChange={filter(setNeedsHours)}
              label="Needs hours"
              size="sm"
            />
            <Switch checked={removed} onCheckedChange={filter(setRemoved)} label="Removed" size="sm" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              leadingIcon={<Download aria-hidden />}
              onClick={() => exportRows(rows)}
              disabled={rows.length === 0}
            >
              Export CSV
            </Button>
          </div>
        </div>

        {chosen.length > 0 ? (
          <div
            role="region"
            aria-label="Change the chosen entries"
            data-testid="bulk-bar"
            className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-primary-subtle px-3 py-2"
          >
            <span className="text-sm font-medium text-fg">
              {chosen.length} chosen
              {editable.length < chosen.length
                ? `, ${chosen.length - editable.length} in a closed month`
                : ''}
            </span>
            {removed ? (
              <Button
                variant="secondary"
                leadingIcon={<RotateCcw aria-hidden />}
                onClick={() => void restoreRows(editable)}
                loading={restore.pending}
                disabled={!canLog || editable.length === 0}
              >
                Put back
              </Button>
            ) : (
              <>
                <Select
                  aria-label="New labor class for the chosen entries"
                  className="w-44"
                  placeholder="Set labor class"
                  value={bulkClass}
                  onValueChange={setBulkClass}
                  options={[
                    { value: 'none', label: 'Default class' },
                    ...laborClasses
                      .filter((item) => !item.archivedAt)
                      .map((item) => ({ value: item.id, label: item.name })),
                  ]}
                />
                <Button
                  variant="secondary"
                  onClick={() => void setClassForChosen()}
                  loading={bulk.pending}
                  disabled={!canLog || !bulkClass || editable.length === 0}
                >
                  Apply
                </Button>
                <Button
                  variant="secondary"
                  leadingIcon={<Download aria-hidden />}
                  onClick={() => exportRows(chosen)}
                >
                  Export
                </Button>
                <Button
                  variant="danger"
                  leadingIcon={<Trash2 aria-hidden />}
                  onClick={() => void removeRows(editable)}
                  loading={remove.pending}
                  disabled={!canLog || editable.length === 0}
                >
                  Remove
                </Button>
              </>
            )}
            <IconButton
              label="Clear the choice"
              icon={<X aria-hidden />}
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setSelected(new Set())}
            />
          </div>
        ) : null}

        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label="Loading entries">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} height={28} className="w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-base font-medium text-fg">We could not load the entries</p>
            <p className="max-w-md text-sm text-fg-muted">{query.error.message}</p>
            <Button
              variant="secondary"
              leadingIcon={<RefreshCw aria-hidden />}
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <Teach
            icon={ClipboardList}
            title={
              removed
                ? 'Nothing was removed in these days'
                : hasFilters
                  ? 'No entries match these filters'
                  : 'No entries in these days'
            }
            why="Each row logged on the day grid, typed on the floor tablet or brought in from a spreadsheet is listed here. Filter by day, site or labor class, fix many rows at once, and export what you see."
            actions={
              <>
                <ButtonLink href={routes.log()} icon={<ClipboardPen aria-hidden />}>
                  Log today
                </ButtonLink>
                {canLog ? (
                  <ButtonLink
                    href={routes.newImport('production')}
                    variant="secondary"
                    icon={<FileSpreadsheet aria-hidden />}
                  >
                    Import production
                  </ButtonLink>
                ) : null}
              </>
            }
            footnote={hasFilters || removed ? 'Try a wider range of days, or clear the filters.' : undefined}
          />
        ) : (
          <>
            <ul className="divide-y divide-border-subtle lg:hidden" aria-label="Entries">
              {pageDays.map((item) => {
                const { day, first } = item;
                const chosenDay = dayChoice(item) === true;
                return (
                  <li
                    key={item.key}
                    data-testid="entry-card"
                    className={cn(
                      'flex items-start gap-3 px-3 py-2.5',
                      chosenDay && 'bg-selected',
                      first.deletedAt && 'text-fg-muted',
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      aria-label={`Choose ${dayName(item)}`}
                      checked={dayChoice(item)}
                      onCheckedChange={(on) => toggleDay(item, on === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">
                        <span className="text-fg-secondary">{first.jobNumber}</span> {first.jobName}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {weekdayName(first.workDate).slice(0, 3)}, {shortDate(first.workDate)}.{' '}
                        {crewLines(item).join('; ')}
                      </p>
                      <p className="mt-0.5 text-sm tabular-nums text-fg-secondary">
                        {formatNumber(day.unitsGood, { maxDigits: 0 })} units,{' '}
                        {day.headcount ? `${formatNumber(day.headcount)} ${Number(day.headcount) === 1 ? 'person' : 'people'}, ` : ''}
                        {day.hoursConfirmed ? `${formatHours(day.hours)} labor hours` : 'needs hours'}
                        {shell.seesMoney && day.laborCostCents !== null ? `, ${formatMoney(day.laborCostCents)}` : ''}
                      </p>
                    </div>
                    {day.locked ? (
                      <span className="text-xs text-fg-muted">Closed</span>
                    ) : first.deletedAt ? (
                      <IconButton
                        label={`Put back ${dayName(item)}`}
                        icon={<RotateCcw aria-hidden />}
                        variant="ghost"
                        disabled={!canLog}
                        onClick={() => void restoreRows(day.rows)}
                      />
                    ) : (
                      <span className="flex items-center">
                        <IconButton
                          label={`Edit ${dayName(item)}`}
                          icon={<Pencil aria-hidden />}
                          variant="ghost"
                          disabled={!canLog}
                          onClick={() => openDay(item)}
                        />
                        <IconButton
                          label={`Remove ${dayName(item)}`}
                          icon={<Trash2 aria-hidden />}
                          variant="ghost"
                          disabled={!canLog}
                          onClick={() => void removeRows(day.rows)}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="hidden lg:block">
              <Table className="min-w-[720px]" aria-label="Work entries">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell className="w-9">
                      <Checkbox
                        aria-label="Choose every entry on this page"
                        checked={
                          allOnPage
                            ? true
                            : pageRows.some((row) => selected.has(row.id))
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={(on) =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            for (const row of pageRows)
                              if (on === true) next.add(row.id);
                              else next.delete(row.id);
                            return next;
                          })
                        }
                      />
                    </TableHeaderCell>
                    <TableHeaderCell>Day</TableHeaderCell>
                    <TableHeaderCell>Job</TableHeaderCell>
                    <TableHeaderCell className="hidden lg:table-cell">Labor</TableHeaderCell>
                    <TableHeaderCell numeric>Units good</TableHeaderCell>
                    <TableHeaderCell numeric className="hidden xl:table-cell">
                      Scrap
                    </TableHeaderCell>
                    <TableHeaderCell numeric>People</TableHeaderCell>
                    <TableHeaderCell numeric>Labor hours</TableHeaderCell>
                    <TableHeaderCell numeric className="hidden md:table-cell">
                      Pace
                    </TableHeaderCell>
                    {shell.seesMoney ? <TableHeaderCell numeric>Labor cost</TableHeaderCell> : null}
                    <TableHeaderCell className="hidden xl:table-cell">Source</TableHeaderCell>
                    <TableHeaderCell className="hidden xl:table-cell">Note</TableHeaderCell>
                    <TableHeaderCell className="w-20">
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageDays.map((item) => {
                    const { day, first } = item;
                    const sources = [...new Set(day.sources)];
                    return (
                      <TableRow
                        key={item.key}
                        data-selected={dayChoice(item) === true}
                        data-testid="entry-row"
                        className={cn(first.deletedAt && 'text-fg-muted')}
                      >
                        <TableCell>
                          <Checkbox
                            aria-label={`Choose ${dayName(item)}`}
                            checked={dayChoice(item)}
                            onCheckedChange={(on) => toggleDay(item, on === true)}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Link
                            href={routes.log({ date: first.workDate, site: first.siteId, job: first.jobNumber })}
                            className="hover:text-fg-link hover:underline"
                            title="Open this day"
                          >
                            {weekdayName(first.workDate).slice(0, 3)}, {shortDate(first.workDate)}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          <Link
                            href={routes.job(first.jobNumber)}
                            className="block truncate hover:text-fg-link hover:underline"
                            title={`${first.jobNumber} ${first.jobName}`}
                          >
                            <span className="text-fg-secondary">{first.jobNumber}</span> {first.jobName}
                          </Link>
                          {sites.length > 1 ? (
                            <span className="block truncate text-xs text-fg-muted">
                              {siteById.get(first.siteId)?.name}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell" data-testid="entry-crew">
                          {crewLines(item).map((line) => (
                            <span key={line} className="block">
                              {line}
                            </span>
                          ))}
                        </TableCell>
                        <TableCell numeric>{formatNumber(day.unitsGood, { maxDigits: 0 })}</TableCell>
                        <TableCell numeric className="hidden xl:table-cell">
                          {Number(day.unitsScrap) > 0 ? formatNumber(day.unitsScrap, { maxDigits: 0 }) : ''}
                        </TableCell>
                        <TableCell numeric>{day.headcount ? formatNumber(day.headcount) : ''}</TableCell>
                        <TableCell numeric>
                          {!day.hoursConfirmed ? (
                            <Badge tone="warning" size="sm">
                              Needs hours
                            </Badge>
                          ) : (
                            formatHours(day.hours)
                          )}
                        </TableCell>
                        <TableCell numeric className="hidden md:table-cell">
                          {day.pace === null ? '' : formatPace(day.pace)}
                        </TableCell>
                        {shell.seesMoney ? (
                          <TableCell numeric>
                            {day.needsRate ? (
                              <Badge tone="warning" size="sm">
                                No rate
                              </Badge>
                            ) : (
                              formatMoney(day.laborCostCents)
                            )}
                          </TableCell>
                        ) : null}
                        <TableCell className="hidden xl:table-cell">
                          {sources.length === 1 ? SOURCE_LABELS[sources[0] as StreamSource] : 'Mixed'}
                        </TableCell>
                        <TableCell
                          className="hidden max-w-[200px] truncate xl:table-cell"
                          title={day.notes[0] ?? undefined}
                        >
                          {day.notes[0]}
                        </TableCell>
                        <TableCell>
                          {day.locked ? (
                            <span className="text-xs text-fg-muted">Closed</span>
                          ) : first.deletedAt ? (
                            <IconButton
                              label={`Put back ${dayName(item)}`}
                              icon={<RotateCcw aria-hidden />}
                              size="sm"
                              variant="ghost"
                              disabled={!canLog}
                              onClick={() => void restoreRows(day.rows)}
                            />
                          ) : (
                            <span className="flex items-center justify-end gap-0.5">
                              <IconButton
                                label={`Edit ${dayName(item)}`}
                                icon={<Pencil aria-hidden />}
                                size="sm"
                                variant="ghost"
                                disabled={!canLog}
                                onClick={() => openDay(item)}
                              />
                              <IconButton
                                label={`Remove ${dayName(item)}`}
                                icon={<Trash2 aria-hidden />}
                                size="sm"
                                variant="ghost"
                                disabled={!canLog}
                                onClick={() => void removeRows(day.rows)}
                              />
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <TablePagination page={page} pageCount={pageCount} total={jobDays.length} onPageChange={setPage}>
              <span className="whitespace-nowrap">
                {formatNumber(totals.units, { maxDigits: 0 })} units, {formatHours(totals.hours)} labor hours
              </span>
            </TablePagination>
          </>
        )}
      </Panel>
      {editingDay ? (
        <EditDay
          key={`${editingDay.key}:${editingDay.day.rows.map((row) => `${row.id}.${row.version}`).join(',')}`}
          item={editingDay}
          days={groupWorkDays(rows.filter((row) => row.jobId === editingDay.jobId))}
          today={today}
          shiftHours={settings.data?.defaultShiftHours ?? '8'}
          laborClasses={laborClasses}
          refresh={refreshEntries}
          onOpenDay={(workDate) => {
            const next = jobDays.find((item) => item.jobId === editingDay.jobId && item.first.workDate === workDate);
            if (next) setEditingDay(next);
          }}
          onClose={() => setEditingDay(null)}
        />
      ) : null}
      {editing ? (
        <EditEntry
          key={editing.id}
          entry={editing}
          laborClasses={laborClasses}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function EditEntry({
  entry,
  laborClasses,
  onClose,
}: {
  readonly entry: ProductionEntryDTO;
  readonly laborClasses: readonly LaborClassDTO[];
  readonly onClose: () => void;
}) {
  const [values, setValues] = useState<LineValues>(() => valuesFromEntry(entry));
  const [date, setDate] = useState(entry.workDate);
  const [error, setError] = useState<string | null>(null);
  const save = useServerAction(saveProductionEntryAction, {
    invalidate: INVALIDATE,
    silentError: true,
    onError: (problem) => setError(problem.message),
  });

  const set = (field: Parameters<typeof applyField>[1], text: string) =>
    setValues(applyField(values, field, text));

  async function submit() {
    const problem = lineProblem(values);
    if (problem) return setError(problem);
    setError(null);
    const before = { ...toPayload(valuesFromEntry(entry)), workDate: entry.workDate };
    const saved = await save.run({
      id: entry.id,
      jobId: entry.jobId,
      workDate: date,
      version: entry.version,
      ...toPayload(values),
    });
    if (!saved) return;
    onClose();
    toast.undo(`Saved ${entry.jobNumber} for ${shortDate(date)}`, {
      onUndo: async () =>
        void (await save.run({ id: entry.id, jobId: entry.jobId, version: saved.entry.version, ...before })),
    });
  }

  const numberField = (
    field:
      'unitsGood' | 'unitsScrap' | 'unitsRework' | 'people' | 'hoursEach' | 'hours' | 'overtime' | 'setup',
    label: string,
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      {({ inputId }) => (
        <Input
          id={inputId}
          inputMode="decimal"
          value={values[field]}
          onChange={(event) => set(field, event.target.value)}
          className="text-right tabular-nums"
        />
      )}
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          title={`Edit ${entry.jobNumber}`}
          description={entry.jobName}
          icon={<Pencil aria-hidden />}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Day">
                {({ inputId }) => (
                  <IsoDatePicker
                    id={inputId}
                    value={date}
                    onChange={(value) => value && setDate(value)}
                    clearable={false}
                  />
                )}
              </Field>
              <Field label="Labor class">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={values.laborClassId ?? 'none'}
                    onValueChange={(value) =>
                      setValues({ ...values, laborClassId: value === 'none' ? null : value })
                    }
                    options={[
                      { value: 'none', label: 'Default class' },
                      ...laborClasses
                        .filter((item) => !item.archivedAt || item.id === values.laborClassId)
                        .map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {numberField('unitsGood', 'Units good')}
              {numberField('unitsScrap', 'Scrap')}
              {numberField('unitsRework', 'Rework')}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {numberField('people', 'People')}
              {numberField('hoursEach', 'Hours each')}
              {numberField('hours', 'Labor hours', 'People times hours each')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {numberField('overtime', 'Overtime hours', 'Part of the labor hours')}
              {numberField('setup', 'Setup hours', 'Do not count in the pace')}
            </div>
            <Field label="Note">
              {({ inputId }) => (
                <Input
                  id={inputId}
                  value={values.note}
                  maxLength={1000}
                  onChange={(event) => setValues({ ...values, note: event.target.value })}
                />
              )}
            </Field>
            {error ? (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edits a whole day of a job, every labor type at once, in the same form as the job's Work log. */
function EditDay({
  item,
  days,
  today,
  shiftHours,
  laborClasses,
  refresh,
  onOpenDay,
  onClose,
}: {
  readonly item: JobDay;
  readonly days: ReturnType<typeof groupWorkDays>;
  readonly today: string;
  readonly shiftHours: string;
  readonly laborClasses: readonly LaborClassDTO[];
  readonly refresh: () => Promise<unknown>;
  readonly onOpenDay: (workDate: string) => void;
  readonly onClose: () => void;
}) {
  const saved = async (result: DaySaved) => {
    onClose();
    await refresh();
    const before = result.before;
    if (!before) return;
    toast.undo(`Saved ${item.first.jobNumber} for ${shortDate(result.workDate)}`, {
      description: 'Undo puts the day back the way it was.',
      onUndo: async () => {
        const live = new Set(result.entries.map((row) => row.id));
        const back = await saveDay({
          jobId: item.jobId,
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
      },
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader
          title={`Edit ${item.first.jobNumber}`}
          description={item.first.jobName}
          icon={<Pencil aria-hidden />}
        />
        <DialogBody>
          <WorkEntryForm
            jobId={item.jobId}
            unit="units"
            day={item.day}
            days={days}
            today={today}
            shiftHours={shiftHours}
            laborClasses={laborClasses}
            defaultLaborClassId={item.first.laborClassId}
            onSaved={saved}
            onCancel={onClose}
            onOpenDay={onOpenDay}
            onStale={async () => {
              await refresh();
              onClose();
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
