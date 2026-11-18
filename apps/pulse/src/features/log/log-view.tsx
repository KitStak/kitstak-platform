'use client';
/** Log work, day view: pick a day and a site, type the day, see pace and money as you go. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardPen,
  Copy,
  Keyboard,
  Lock,
  PackagePlus,
  RefreshCw,
  Search,
  TabletSmartphone,
  Undo2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  IconButton,
  Input,
  IsoDatePicker,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Skeleton,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { DeviceLinksPanel } from '@/features/kiosk/device-links-panel';
import { useShell } from '@/features/shell/shell-context';
import { formatLongDate } from '@/lib/dates';
import { formatHours, formatMoney, formatNumber, formatPercentBp } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { useClients, useLogGrid, usePreviousCrew } from '@/lib/hooks/use-data';
import { useHotkey } from '@/lib/hooks/use-hotkeys';
import { addDays, shortDate } from '@/lib/profit';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { LaborClassDTO, LogGridDTO, SiteDTO } from '@/lib/types';
import { quickAddJobAction } from '@/server/actions/jobs';
import { markDayCompleteAction, reviewDayAction } from '@/server/actions/log';
import { JobFocusBanner } from './job-focus-banner';
import type { FocusJob } from './job-focus';
import { LogGrid, type GridTotals, type LogGridHandle } from './log-grid';
import { moneyReadout, type PaceThresholds } from './log-math';
import { OtherTimeStrip } from './other-time';

export interface LogViewProps {
  readonly initial: LogGridDTO;
  readonly sites: readonly SiteDTO[];
  readonly laborClasses: readonly LaborClassDTO[];
  readonly thresholds: PaceThresholds;
  readonly focusJob?: string | null;
  /** The job a `?job=` link asked for, as the server found it. */
  readonly focus?: FocusJob | null;
}


/**
 * The footer totals straight from the saved day, so the footer is right on the first paint. The
 * grid replaces them with live totals (typed but unsaved rows included) once it is on screen.
 */
function savedTotals(grid: LogGridDTO, seesMoney: boolean): GridTotals {
  let units = 0;
  let hours = 0;
  let people = 0;
  let jobsLogged = 0;
  const entries = grid.rows.flatMap((row) => row.entries);
  for (const row of grid.rows) {
    let rowUnits = 0;
    let rowHours = 0;
    for (const entry of row.entries) {
      rowUnits += Number(entry.unitsGood) || 0;
      rowHours += Number(entry.hours) || 0;
      people += Number(entry.headcount ?? 0) || 0;
    }
    units += rowUnits;
    hours += rowHours;
    if (rowUnits > 0 || rowHours > 0) jobsLogged += 1;
  }
  return { units, hours, people, jobsLogged, jobs: grid.rows.length, money: seesMoney ? moneyReadout(entries) : null, unsaved: 0 };
}

export function LogView({ initial, sites, laborClasses, thresholds, focusJob, focus }: LogViewProps) {
  const shell = useShell();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(initial.date);
  const [siteId, setSiteId] = useState(initial.siteId);
  const [filter, setFilter] = useState('');
  const [totals, setTotals] = useState<GridTotals>(() => savedTotals(initial, shell.seesMoney));
  const [quickAdd, setQuickAdd] = useState(false);
  const [tablet, setTablet] = useState(false);
  const [focusDismissed, setFocusDismissed] = useState(false);
  const gridRef = useRef<LogGridHandle>(null);
  const isInitial = date === initial.date && siteId === initial.siteId;
  const grid = useLogGrid(
    { date, siteId },
    {
      initialData: isInitial ? initial : undefined,
      placeholderData: undefined,
      retry: 1,
      refetchOnWindowFocus: totals.unsaved === 0,
    },
  );
  const crew = usePreviousCrew({ date, siteId }, { enabled: shell.can('production:log') });
  const data = grid.data;
  const site = sites.find((item) => item.id === siteId);
  const today = site?.today ?? initial.today;
  const canLog = shell.can('production:log');

  const go = useCallback(
    (nextDate: string, nextSite = siteId) => {
      gridRef.current?.flush();
      setDate(nextDate);
      setSiteId(nextSite);
      setFilter('');
      window.history.replaceState(null, '', routes.log({ date: nextDate, site: nextSite }));
    },
    [siteId],
  );

  const findRef = useRef<HTMLInputElement>(null);
  useHotkey('f', () => findRef.current?.focus());
  useHotkey('[', () => go(addDays(date, -1)));
  useHotkey(']', () => go(addDays(date, 1)));

  useEffect(() => {
    if (focusJob && data) {
      const row = data.rows.find(
        (item) => item.jobId === focusJob || item.jobNumber.toLowerCase() === focusJob.toLowerCase(),
      );
      if (row) setTimeout(() => gridRef.current?.focusJob(row.jobId), 80);
    }
    // Only when the day first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusJob, Boolean(data)]);

  const refreshDay = () => queryClient.invalidateQueries({ queryKey: qk.streams() });
  const focusMissing =
    Boolean(focus) &&
    !focusDismissed &&
    data !== undefined &&
    !data.rows.some((item) => item.jobId === focus?.id || item.jobNumber.toLowerCase() === (focus?.number ?? focus?.ref ?? '').toLowerCase());
  const complete = useServerAction(markDayCompleteAction, { invalidate: [qk.streams()] });
  const review = useServerAction(reviewDayAction, { invalidate: [qk.streams()] });

  async function markComplete() {
    gridRef.current?.flush();
    const done = await complete.run({ siteId, date });
    if (!done) return;
    const flags = done.flags.length;
    toast.undo(
      flags > 0
        ? `Day marked complete. ${flags} ${flags === 1 ? 'row looks' : 'rows look'} odd, a manager will check.`
        : 'Day marked complete',
      {
        onUndo: async () => {
          if (shell.can('day:review')) await review.run({ siteId, date, decision: 'reopen' });
          else
            toast.info(
              'Ask a manager to send the day back',
              'Only a manager can open a day again once it is marked complete.',
            );
        },
        undoLabel: shell.can('day:review') ? 'Undo' : 'How to undo',
      },
    );
  }

  async function copyYesterday() {
    if (!crew.data || crew.data.length === 0) {
      toast.info('No earlier crew to copy', 'None of these jobs had hours logged in the last 30 days.');
      return;
    }
    const filled = await gridRef.current?.copyCrew(crew.data);
    if (!filled) toast.info('Nothing to copy', 'Every job with an earlier crew already has hours today.');
  }

  const crewDay = useMemo(() => {
    const days = (crew.data ?? []).map((item) => item.workDate).sort();
    return days.length > 0 ? days[days.length - 1]! : null;
  }, [crew.data]);

  const siteOptions = sites
    .filter((item) => !item.archivedAt || item.id === siteId)
    .map((item) => ({ value: item.id, label: item.name }));

  return (
    <div className="flex flex-col gap-4" data-testid="log-view">
      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2.5">
          <div className="flex items-center gap-1" role="group" aria-label="Day">
            <IconButton
              label="Day before"
              shortcut={['[']}
              icon={<ChevronLeft aria-hidden />}
              variant="ghost"
              onClick={() => go(addDays(date, -1))}
            />
            <IsoDatePicker
              value={date}
              onChange={(value) => value && go(value)}
              aria-label="Day to log"
              clearable={false}
              displayFormat="EEE, MMM d"
            />
            <IconButton
              label="Day after"
              shortcut={[']']}
              icon={<ChevronRight aria-hidden />}
              variant="ghost"
              onClick={() => go(addDays(date, 1))}
            />
            {date !== today ? (
              <Button variant="tertiary" onClick={() => go(today)}>
                Today
              </Button>
            ) : null}
          </div>
          {siteOptions.length > 1 ? (
            <Select
              aria-label="Site"
              value={siteId}
              onValueChange={(value) => go(date, value)}
              options={siteOptions}
              className="w-52 max-w-full"
            />
          ) : null}
          <div className="order-last w-full sm:order-none sm:ml-auto sm:w-56">
            <Input
              leadingIcon={<Search aria-hidden />}
              value={filter}
              ref={findRef}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !data) return;
                const q = filter.trim().toLowerCase();
                const hit = data.rows.find((row) => !q || `${row.jobNumber} ${row.jobName} ${row.clientName}`.toLowerCase().includes(q));
                if (!hit) return;
                event.preventDefault();
                gridRef.current?.focusJob(hit.jobId);
              }}
              placeholder="Find a job (F)"
              aria-label="Find a job on this day. Press Enter to go to it."
              aria-keyshortcuts="F"
            />
          </div>
          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            {canLog && data?.canEdit ? (
              <Button
                variant="secondary"
                leadingIcon={<Copy aria-hidden />}
                onClick={() => void copyYesterday()}
                disabled={crew.isFetching && !crew.data}
                title={
                  crewDay
                    ? `Fills people and hours from the last day each job ran, most recently ${shortDate(crewDay)}`
                    : undefined
                }
              >
                <span className="hidden sm:inline">Copy yesterday’s crew</span>
                <span className="sm:hidden">Copy crew</span>
              </Button>
            ) : null}
            {shell.can('job:manage') ? (
              <Button
                variant="secondary"
                leadingIcon={<PackagePlus aria-hidden />}
                onClick={() => setQuickAdd(true)}
              >
                <span className="hidden sm:inline">Add a job</span>
                <span className="sm:hidden">Job</span>
              </Button>
            ) : null}
            {canLog ? (
              <IconButton
                label="Floor tablet"
                icon={<TabletSmartphone aria-hidden />}
                variant="ghost"
                onClick={() => setTablet(true)}
              />
            ) : null}
            <KeysHelp />
          </div>
        </div>

        {focus && focusMissing && data ? (
          <JobFocusBanner
            key={`${data.date}:${data.siteId}`}
            job={focus}
            date={data.date}
            siteId={data.siteId}
            canManage={shell.can('job:manage')}
            onGo={(nextDate, nextSite) => go(nextDate, nextSite)}
            onDismiss={() => setFocusDismissed(true)}
            onStarted={async (jobId) => {
              await refreshDay();
              setTimeout(() => gridRef.current?.focusJob(jobId), 250);
            }}
          />
        ) : null}
        {data ? (
          <DayBanner
            data={data}
            onReopen={
              shell.can('day:review')
                ? () => void review.run({ siteId, date, decision: 'reopen' })
                : undefined
            }
            reopening={review.pending}
          />
        ) : null}

        {grid.isError && !data ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" role="alert">
            <p className="text-base font-medium text-fg">We could not load this day</p>
            <p className="max-w-md text-sm text-fg-muted">{grid.error.message}</p>
            <Button
              variant="secondary"
              leadingIcon={<RefreshCw aria-hidden />}
              onClick={() => void grid.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : !data ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label="Loading the day">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} height={36} className="w-full" />
            ))}
          </div>
        ) : data.rows.length === 0 ? (
          <Teach
            icon={ClipboardPen}
            title="No jobs are running on this day"
            why="Each active job at this site gets one row here. Type the units finished, how many people worked on it and the hours each, and Pulse works out the labor cost and the pace."
            points={[
              'Tab and Enter move through the grid, no mouse needed',
              'Pace against the target shows as you type',
              'Every row saves itself, with undo',
            ]}
            actions={
              <>
                {shell.can('job:manage') ? (
                  <Button leadingIcon={<PackagePlus aria-hidden />} onClick={() => setQuickAdd(true)}>
                    Add a job
                  </Button>
                ) : null}
                <ButtonLink href={routes.jobs()} variant="secondary">
                  See jobs
                </ButtonLink>
              </>
            }
            footnote={
              shell.can('job:manage')
                ? 'A job shows up here once it is active and its start day has come.'
                : 'Ask a manager to add the first job, then come back to log the day.'
            }
          />
        ) : (
          <div className="py-2">
            <LogGrid
              key={`${data.date}:${data.siteId}`}
              ref={gridRef}
              grid={data}
              laborClasses={laborClasses}
              thresholds={thresholds}
              seesMoney={shell.seesMoney}
              filter={filter}
              onTotals={setTotals}
            />
          </div>
        )}

        {data && data.rows.length > 0 ? (
          <div
            data-testid="log-totals"
            className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border-default bg-sunken px-4 py-3 md:sticky md:bottom-0 md:z-10"
          >
            <Total label="Units good" value={formatNumber(totals.units, { maxDigits: 0 })} />
            <Total label="Labor hours" value={formatHours(totals.hours)} />
            <Total label="Jobs logged" value={`${totals.jobsLogged} of ${totals.jobs}`} />
            {totals.money ? (
              <>
                <Total label="Labor cost today" value={formatMoney(totals.money.laborCents)} />
                <Total label="Earned today" value={formatMoney(totals.money.revenueCents)} />
                <Total
                  label="Margin today"
                  value={
                    totals.money.marginBp === null ? 'No revenue yet' : formatPercentBp(totals.money.marginBp)
                  }
                  tone={totals.money.profitCents < 0 ? 'bad' : undefined}
                  hint="Earned minus labor, materials and the share of time not on a job, divided by earned. Open the info button on a row for its own numbers."
                />
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-fg-muted" aria-live="polite">
                {(totals.stuck ?? 0) > 0
                  ? `${totals.stuck} ${totals.stuck === 1 ? 'row is' : 'rows are'} not saved. Fix the red ${totals.stuck === 1 ? 'row' : 'rows'} first.`
                  : totals.unsaved > 0
                    ? `Saving ${totals.unsaved} ${totals.unsaved === 1 ? 'row' : 'rows'}`
                    : 'All changes saved'}
              </span>
              {canLog && data.canEdit && !data.review ? (
                <Button
                  leadingIcon={<CheckCircle2 aria-hidden />}
                  onClick={() => void markComplete()}
                  loading={complete.pending}
                  disabled={totals.unsaved > 0}
                >
                  Mark day complete
                </Button>
              ) : null}
              {canLog && data.canEdit && data.review?.status === 'sent_back' ? (
                <Button
                  leadingIcon={<CheckCircle2 aria-hidden />}
                  onClick={() => void markComplete()}
                  loading={complete.pending}
                  disabled={totals.unsaved > 0}
                >
                  Mark complete again
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Panel>

      {data ? (
        <Panel>
          <OtherTimeStrip
            date={data.date}
            siteId={data.siteId}
            indirect={data.indirect}
            paid={data.paid}
            laborClasses={laborClasses}
            canEdit={data.canEdit && canLog}
            seesMoney={shell.seesMoney}
            shiftHours={data.shiftHours}
          />
        </Panel>
      ) : null}

      <QuickAddJob
        key={quickAdd ? 'open' : 'closed'}
        open={quickAdd}
        onOpenChange={setQuickAdd}
        siteId={siteId}
        date={date}
        onAdded={async (jobId) => {
          await refreshDay();
          setTimeout(() => gridRef.current?.focusJob(jobId), 250);
        }}
      />
      <Dialog open={tablet} onOpenChange={setTablet}>
        <DialogContent size="lg">
          <DialogHeader
            title="Floor tablet"
            description="A shared tablet on the floor for logging units, people and hours. It needs no sign in: people pick their name and type a 4 digit PIN."
            icon={<TabletSmartphone aria-hidden />}
          />
          <DialogBody>
            <DeviceLinksPanel kind="kiosk" defaultSiteId={siteId} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Total({
  label,
  value,
  tone,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'bad';
  readonly hint?: string;
}) {
  return (
    <div className="flex flex-col" title={hint}>
      <span className="text-xs text-fg-muted">{label}</span>
      <span
        className={cn('text-md font-semibold tabular-nums', tone === 'bad' ? 'text-danger-text' : 'text-fg')}
      >
        {value}
      </span>
    </div>
  );
}

function DayBanner({
  data,
  onReopen,
  reopening,
}: {
  readonly data: LogGridDTO;
  readonly onReopen?: () => void;
  readonly reopening: boolean;
}) {
  const review = data.review;
  if (!review && data.canEdit) return null;
  const sentBack = review?.status === 'sent_back';
  const tone = sentBack
    ? 'bg-warning-subtle text-warning-text'
    : review?.status === 'approved'
      ? 'bg-success-subtle text-success-text'
      : 'bg-info-subtle text-info-text';
  const words = data.monthClosed
    ? 'This month is closed, so the day cannot change. An owner can reopen the month under Settings, Month close.'
    : sentBack
      ? `A manager sent this day back${review?.note ? `: “${review.note}”` : '.'} Fix it, then mark it complete again.`
      : review?.status === 'approved'
        ? data.canEdit
          ? 'This day is approved. You can still change it, and the numbers update right away.'
          : (data.lockedReason ?? 'This day is approved. Ask a manager if it needs a fix.')
        : review?.status === 'complete'
          ? data.canEdit
            ? 'This day is marked complete and is waiting for review. You can still fix rows.'
            : 'This day is marked complete. Ask a manager to send it back if it needs a fix.'
          : (data.lockedReason ?? 'You can look at this day but not change it.');
  return (
    <div
      data-testid="day-banner"
      role="status"
      className={cn('flex flex-wrap items-center gap-2 px-4 py-2 text-sm', tone)}
    >
      {sentBack ? (
        <Undo2 aria-hidden className="size-4 shrink-0" />
      ) : review?.status ? (
        <CheckCircle2 aria-hidden className="size-4 shrink-0" />
      ) : (
        <Lock aria-hidden className="size-4 shrink-0" />
      )}
      <span className="min-w-[12rem] flex-1">{words}</span>
      {review && !data.monthClosed ? (
        <span className="flex items-center gap-2">
          {onReopen ? (
            <ButtonLink href={routes.logReview()} variant="tertiary" size="sm">
              Open review
            </ButtonLink>
          ) : null}
          {onReopen && review.status !== 'sent_back' ? (
            <Button variant="secondary" size="sm" onClick={onReopen} loading={reopening}>
              Open the day again
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function KeysHelp() {
  const rows: readonly (readonly [readonly string[], string])[] = [
    [['Tab'], 'Next cell'],
    [['Enter'], 'Save and move down'],
    [['↑', '↓'], 'Move up and down'],
    [['Esc'], 'Put the row back'],
    [['Ctrl', 'D'], 'Copy the cell above'],
    [['[', ']'], 'Day before, day after'],
    [['F'], 'Find a job, then Enter to go to it'],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Keys and paste help" icon={<Keyboard aria-hidden />} variant="ghost" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-32px)]">
        <h3 className="text-sm font-semibold text-fg">Type the whole day without the mouse</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.map(([keys, text]) => (
            <li key={text} className="flex items-center justify-between gap-3 text-sm text-fg-secondary">
              <span>{text}</span>
              <span className="flex items-center gap-1">
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <h3 className="mt-3 text-sm font-semibold text-fg">Paste from a spreadsheet</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Copy cells in your spreadsheet, click a cell here and paste. The cells fill to the right and down
          from where you clicked.
        </p>
        <p className="mt-1 text-sm text-fg-secondary">
          If the first copied column holds job numbers, each row goes to its job. The next columns are units,
          people, hours each and a note.
        </p>
        <p className="mt-2 text-xs text-fg-muted">
          Rows save by themselves. Each row has its own undo, and a paste can be undone in one go.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function QuickAddJob({
  open,
  onOpenChange,
  siteId,
  date,
  onAdded,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly siteId: string;
  readonly date: string;
  readonly onAdded: (jobId: string) => void | Promise<void>;
}) {
  const clients = useClients({ activeOnly: true }, { enabled: open });
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [name, setName] = useState('');
  const [units, setUnits] = useState('');
  const [price, setPrice] = useState('');
  const add = useServerAction(quickAddJobAction, { silentError: true, invalidate: [qk.jobsRoot()] });
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!clientId && !clientName.trim()) return setError('Pick a client, or type a new client name.');
    if (!name.trim()) return setError('Give the job a name.');
    setError(null);
    const job = await add.run({
      clientId,
      clientName: clientId ? null : clientName.trim(),
      name: name.trim(),
      plannedUnits: units.trim() ? units.replace(/,/g, '') : null,
      unitPrice: price.trim() ? price.replace(/[$,]/g, '') : null,
      siteId,
    });
    if (!job) {
      setError(
        add.fieldErrors.name ??
          add.fieldErrors.plannedUnits ??
          add.fieldErrors.unitPrice ??
          add.fieldErrors.clientId ??
          'We could not add the job. Check the numbers and try again.',
      );
      return;
    }
    toast.success(`Added ${job.number}`, `It is on the grid for ${formatLongDate(date)}.`);
    onOpenChange(false);
    await onAdded(job.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title="Add a job"
          description="For a job that is running today and is not on the grid yet. You can fill in the rest on the job page later."
          icon={<PackagePlus aria-hidden />}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="flex flex-col gap-3">
            <Field
              label="Client"
              required
              hint={clientId ? undefined : 'Pick one, or type a new name below.'}
            >
              {({ inputId }) => (
                <Combobox
                  id={inputId}
                  value={clientId}
                  onValueChange={setClientId}
                  options={(clients.data ?? []).map((client) => ({ value: client.id, label: client.name }))}
                  placeholder={clients.isLoading ? 'Loading clients' : 'Pick a client'}
                  searchPlaceholder="Search clients"
                  emptyMessage="No client by that name. Type it as a new client below."
                />
              )}
            </Field>
            {!clientId ? (
              <Field label="Or a new client">
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                    placeholder="Client name"
                    maxLength={200}
                  />
                )}
              </Field>
            ) : null}
            <Field label="Job name" required>
              {({ inputId }) => (
                <Input
                  id={inputId}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Holiday gift set, wave 2"
                  maxLength={200}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Units planned">
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    inputMode="decimal"
                    value={units}
                    onChange={(event) => setUnits(event.target.value)}
                    placeholder="5,000"
                  />
                )}
              </Field>
              <Field label="Price for each unit">
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="1.25"
                  />
                )}
              </Field>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={add.pending}>
              Add the job
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
