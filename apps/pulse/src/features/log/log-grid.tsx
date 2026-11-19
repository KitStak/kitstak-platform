'use client';
/**
 * The Log work day grid. One block per job running that day; each block has one line per labor
 * class (most jobs have one). A person types units, people and hours each, Pulse shows labor
 * hours and the pace against the target as they type, and each line saves itself.
 *
 * Keyboard: Tab moves across, Enter and the down arrow move down, the up arrow moves up, Escape
 * puts a line back to what was saved, Ctrl or Cmd+D copies the cell above. A block copied from a
 * spreadsheet can be pasted into any cell.
 */
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Copy,
  Info,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  GridSelect,
  PopoverTrigger,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import {
  formatHours,
  formatMoney,
  formatMoneyPerHour,
  formatNumber,
  formatPace,
  formatPercentBp,
} from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type {
  LaborClassDTO,
  LogGridDTO,
  LogGridRowDTO,
  PreviousCrewDTO,
  ProductionEntryDTO,
} from '@/lib/types';
import {
  deleteProductionEntriesAction,
  restoreProductionEntriesAction,
  saveProductionBulkAction,
} from '@/server/actions/log';
import {
  EMPTY_VALUES,
  LINE_FIELDS,
  applyField,
  crewQuestion,
  missingLaborWords,
  isBlank,
  isBlockPaste,
  lineProblem,
  moneyReadout,
  parsePasted,
  parseTyped,
  planPaste,
  rowReadout,
  sameValues,
  tidy,
  toPayload,
  valuesFromEntry,
  type LineField,
  type LineValues,
  type MoneyReadout,
  type PaceThresholds,
  type RowReadout,
} from './log-math';

type LineStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'stale';

interface Line {
  readonly key: string;
  readonly jobId: string;
  readonly shift: string;
  entry: ProductionEntryDTO | null;
  values: LineValues;
  saved: LineValues;
  /** What the line held before its last save, for the row's Undo. */
  undo: LineValues | null;
  status: LineStatus;
  message: string | null;
  showMore: boolean;
}

// Keys must come out the same on the server and in the browser, so they are built from ids.
// Lines a person adds by hand get a counter key; that only ever happens in the browser.
let lineSeq = 0;
const addedKey = (): string => `n:${(lineSeq += 1)}`;

function draftLine(
  row: LogGridRowDTO,
  laborClassId: string | null,
  values: Partial<LineValues> = {},
  key = addedKey(),
): Line {
  const base = { ...EMPTY_VALUES, laborClassId, ...values };
  return {
    key,
    jobId: row.jobId,
    shift: 'day',
    entry: null,
    values: base,
    saved: { ...EMPTY_VALUES, laborClassId },
    undo: null,
    status: 'idle',
    message: null,
    showMore: false,
  };
}

function lineFromEntry(entry: ProductionEntryDTO, key = `e:${entry.id}`): Line {
  const values = valuesFromEntry(entry);
  return {
    key,
    jobId: entry.jobId,
    shift: entry.shift,
    entry,
    values,
    saved: values,
    undo: null,
    status: 'idle',
    message: null,
    showMore: Number(entry.setupHours) > 0,
  };
}

const busy = (line: Line): boolean =>
  line.status === 'dirty' || line.status === 'saving' || line.status === 'error';

/** The line that carries the units comes first, then the job's own labor class, then the rest as logged. */
function orderEntries(row: LogGridRowDTO): ProductionEntryDTO[] {
  const weight = (entry: ProductionEntryDTO): number =>
    (Number(entry.unitsGood) + Number(entry.unitsScrap) + Number(entry.unitsRework) > 0 ? 0 : 2) +
    (entry.laborClassId === row.defaultLaborClassId ? 0 : 1);
  return [...row.entries].sort((a, b) => weight(a) - weight(b));
}

/** Lays fresh server data under the lines a person is still typing in. */
function mergeLines(previous: readonly Line[], grid: LogGridDTO): Line[] {
  const out: Line[] = [];
  for (const row of grid.rows) {
    const mine = previous.filter((line) => line.jobId === row.jobId);
    const used = new Set<string>();
    for (const entry of orderEntries(row)) {
      const old = mine.find((line) => line.entry?.id === entry.id);
      if (old) {
        used.add(old.key);
        out.push(
          busy(old)
            ? { ...old, entry: old.status === 'saving' ? old.entry : entry }
            : {
                ...lineFromEntry(entry, old.key),
                undo: old.undo,
                status: old.status === 'saved' || old.status === 'stale' ? old.status : 'idle',
                message: old.status === 'stale' ? old.message : null,
                showMore: old.showMore || Number(entry.setupHours) > 0,
              },
        );
      } else out.push(lineFromEntry(entry));
    }
    // Drafts a person is typing in, or that were just saved and are waiting for the next refresh.
    for (const old of mine) {
      if (used.has(old.key)) continue;
      if (old.entry && !row.entries.some((entry) => entry.id === old.entry!.id)) {
        if (busy(old) || old.status === 'saved') out.push(old);
        continue;
      }
      if (!old.entry && (busy(old) || !isBlank(old.values))) out.push(old);
    }
    if (!out.some((line) => line.jobId === row.jobId)) {
      const spare = mine.find((line) => !line.entry);
      out.push(spare ?? draftLine(row, row.defaultLaborClassId, {}, `d:${row.jobId}`));
    }
  }
  return out;
}

/** The ids of the saved lines of one job on the grid: what a new line tells the server it saw. */
function seenLines(lines: readonly Line[], jobId: string): string[] {
  return lines.flatMap((line) => (line.jobId === jobId && line.entry ? [line.entry.id] : []));
}

interface SaveResponse {
  data?: { entry: ProductionEntryDTO; created: boolean };
  error?: { code: string; message: string; fresh?: ProductionEntryDTO | null; fields?: Record<string, string> };
}

const SERVER_FIELD_LABELS: Record<string, string> = {
  unitsGood: 'Units good',
  unitsScrap: 'Scrap',
  unitsRework: 'Rework',
  headcount: 'People',
  hours: 'Labor hours',
  overtimeHours: 'Overtime',
  setupHours: 'Setup hours',
  note: 'Note',
};

/** Names the field the server turned down, so "Some fields need another look" never stands alone. */
function saveErrorMessage(error: NonNullable<SaveResponse['error']> | undefined): string {
  if (!error) return 'Something went wrong. Please try again.';
  const first = Object.entries(error.fields ?? {})[0];
  if (error.code !== 'VALIDATION' || !first) return error.message;
  const label = SERVER_FIELD_LABELS[first[0]];
  return label ? `${label}: ${first[1]}` : first[1];
}

async function putRow(
  body: Record<string, unknown>,
): Promise<
  | { ok: true; entry: ProductionEntryDTO }
  | { ok: false; code: string; message: string; fresh?: ProductionEntryDTO | null }
> {
  let response: Response;
  try {
    response = await fetch('/api/v1/log/rows', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Not saved. Check your connection. Pulse will keep trying by itself.',
    };
  }
  let payload: SaveResponse | null = null;
  try {
    payload = (await response.json()) as SaveResponse;
  } catch {
    payload = null;
  }
  if (response.ok && payload?.data) return { ok: true, entry: payload.data.entry };
  return {
    ok: false,
    code: payload?.error?.code ?? 'INTERNAL',
    message: saveErrorMessage(payload?.error),
    fresh: payload?.error?.fresh,
  };
}

export interface LogGridHandle {
  /** Fills people and hours from the last day each job ran. Returns how many jobs were filled. */
  copyCrew: (crew: readonly PreviousCrewDTO[]) => Promise<number>;
  focusJob: (jobId: string) => void;
  /** Saves every line that still has changes. */
  flush: () => void;
}

export interface LogGridProps {
  readonly grid: LogGridDTO;
  readonly laborClasses: readonly LaborClassDTO[];
  readonly thresholds: PaceThresholds;
  readonly seesMoney: boolean;
  readonly filter: string;
  /** Show only these jobs (the review screen fixes odd rows in place). */
  readonly onlyJobs?: readonly string[];
  readonly onTotals?: (totals: GridTotals) => void;
}

export interface GridTotals {
  readonly units: number;
  readonly hours: number;
  readonly people: number;
  readonly jobsLogged: number;
  readonly jobs: number;
  readonly money: MoneyReadout | null;
  readonly unsaved: number;
  /** Rows that could not be saved and need a fix (part of `unsaved`). */
  readonly stuck?: number;
}

const COLS =
  'xl:grid-cols-[minmax(200px,1fr)_88px_60px_60px_128px_60px_76px_84px_64px_minmax(80px,120px)_252px_68px]';

const cellInput =
  'h-10 w-full min-w-0 rounded-md border border-border-input bg-panel px-2 text-right text-sm tabular-nums text-fg placeholder:text-fg-placeholder transition-colors hover:border-border-input-hover focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-disabled xl:h-8';

const DEFAULT_CLASS = 'default';

/**
 * The labor class of one line: the app's own Select (type a letter to jump, Enter or Space opens,
 * arrows move, Tab goes on to People). `GridSelect` draws a plain trigger until a person reaches
 * it, so 30 pickers cost no more to draw than the old browser boxes. Kept apart and memoized so
 * typing in a number box does not draw every picker of the grid again.
 */
const ClassSelect = memo(function ClassSelect({
  label,
  value,
  laborClasses,
  taken,
  disabled,
  lineKey,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly laborClasses: readonly LaborClassDTO[];
  /** Labor class ids the other lines of this job hold, joined with commas: a class can be on one line only. */
  readonly taken: string;
  readonly disabled: boolean;
  readonly lineKey: string;
  readonly onChange: (key: string, laborClassId: string | null) => void;
}) {
  const options = useMemo(() => {
    const used = new Set(taken.split(',').filter(Boolean));
    return [
      { value: DEFAULT_CLASS, label: 'Default class' },
      ...laborClasses
        .filter((item) => !item.archivedAt || item.id === value)
        .map((item) => ({ value: item.id, label: item.name, disabled: used.has(item.id) })),
    ];
  }, [laborClasses, taken, value]);
  return (
    <GridSelect
      aria-label={label}
      disabled={disabled}
      value={value ?? DEFAULT_CLASS}
      onValueChange={(next) => onChange(lineKey, next === DEFAULT_CLASS ? null : next)}
      options={options}
      className="h-10 px-2 xl:h-8"
    />
  );
});

const FIELD_LABELS: Readonly<Record<LineField | 'setup', string>> = {
  unitsGood: 'Units good',
  unitsScrap: 'Scrap',
  unitsRework: 'Rework',
  people: 'People',
  hoursEach: 'Hours each',
  hours: 'Labor hours',
  overtime: 'Overtime',
  note: 'Note',
  setup: 'Setup hours',
};

export const LogGrid = forwardRef<LogGridHandle, LogGridProps>(function LogGrid(
  { grid, laborClasses, thresholds, seesMoney, filter, onlyJobs, onTotals },
  ref,
) {
  const queryClient = useQueryClient();
  const [lines, setLinesState] = useState<Line[]>(() => mergeLines([], grid));
  // The ref always holds the newest lines, so a save that fires right after a keystroke never reads old values.
  const linesRef = useRef(lines);
  const setLines = useCallback((next: Line[] | ((previous: Line[]) => Line[])) => {
    linesRef.current = typeof next === 'function' ? next(linesRef.current) : next;
    setLinesState(linesRef.current);
  }, []);
  const container = useRef<HTMLDivElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocus = useRef<string | null>(null);
  // Lines whose save never reached the server (no connection). They are sent again by themselves.
  const offlineKeys = useRef(new Set<string>());
  const retryOffline = useRef<() => void>(() => undefined);
  const canEdit = grid.canEdit;
  const classById = useMemo(() => new Map(laborClasses.map((item) => [item.id, item])), [laborClasses]);
  const liveClasses = useMemo(() => laborClasses.filter((item) => !item.archivedAt), [laborClasses]);
  const rowById = useMemo(() => new Map(grid.rows.map((row) => [row.jobId, row])), [grid.rows]);

  // Fresh data from the server is laid under whatever is still being typed.
  useEffect(() => {
    setLines((previous) => mergeLines(previous, grid));
  }, [grid, setLines]);

  const update = useCallback(
    (key: string, change: (line: Line) => Line) => {
      setLines((previous) => previous.map((line) => (line.key === key ? change(line) : line)));
    },
    [setLines],
  );

  /** After saves settle, refresh the day and everything that reads from it. */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: qk.streams() });
      void queryClient.invalidateQueries({ queryKey: qk.jobsRoot() });
      void queryClient.invalidateQueries({ queryKey: qk.profitRoot() });
      void queryClient.invalidateQueries({ queryKey: qk.summaryRoot() });
      void queryClient.invalidateQueries({ queryKey: qk.badges() });
    }, 1200);
  }, [queryClient]);

  /** Set below, once `clearLine` exists: the save of a row that was emptied hands over to it. */
  const clearLineRef = useRef<((line: Line) => Promise<void>) | null>(null);

  const saveLine = useCallback(
    async (key: string): Promise<void> => {
      const pending = timers.current.get(key);
      if (pending) clearTimeout(pending);
      timers.current.delete(key);
      const line = linesRef.current.find((item) => item.key === key);
      if (!line || line.status === 'saving' || !canEdit) return;
      // Checked first: a bad "hours each" leaves the labor hours as they were, so the row can look unchanged.
      const problem = lineProblem(line.values);
      if (problem) {
        update(key, (item) => ({ ...item, status: 'error', message: problem }));
        return;
      }
      if (sameValues(line.values, line.saved) && line.status !== 'error') {
        if (line.status === 'dirty') update(key, (item) => ({ ...item, status: 'idle', message: null }));
        return;
      }
      if (!line.entry && isBlank(line.values)) {
        update(key, (item) => ({ ...item, status: 'idle', message: null }));
        return;
      }
      // Every box cleared on a saved row: take the entry off (with Undo) so no empty day is left on the job.
      if (line.entry && isBlank(line.values)) {
        void clearLineRef.current?.(line);
        return;
      }
      // One line for each labor class: a second line with the same class would write over the first.
      const classOf = (item: Line) => item.values.laborClassId ?? rowById.get(item.jobId)?.defaultLaborClassId ?? null;
      const twin = linesRef.current.find(
        (other) =>
          other.key !== key &&
          other.jobId === line.jobId &&
          other.shift === line.shift &&
          classOf(other) === classOf(line),
      );
      if (twin) {
        const name = classById.get(classOf(line) ?? '')?.name ?? 'that labor class';
        update(key, (item) => ({
          ...item,
          status: 'error',
          message: `This job already has a line for ${name}. Pick another labor class, or add these people to that line.`,
        }));
        return;
      }
      const sent = line.values;
      offlineKeys.current.delete(key);
      update(key, (item) => ({ ...item, status: 'saving', message: null }));
      const result = await putRow({
        id: line.entry?.id ?? null,
        jobId: line.jobId,
        workDate: grid.date,
        shift: line.shift,
        version: line.entry?.version ?? null,
        // A new line names the lines of this job the grid shows, so the server can tell when
        // someone else added work to the day in the meantime (the day form follows the same rule).
        seen: seenLines(linesRef.current, line.jobId),
        ...toPayload(sent),
      });
      if (result.ok) {
        update(key, (item) => {
          const still = sameValues(item.values, sent);
          return {
            ...item,
            entry: result.entry,
            saved: sent,
            undo: item.saved,
            status: still ? 'saved' : 'dirty',
            message: null,
            values: still
              ? { ...valuesFromEntry(result.entry), hoursEach: item.values.hoursEach }
              : item.values,
          };
        });
        scheduleRefresh();
        const now = linesRef.current.find((item) => item.key === key);
        if (now && !sameValues(now.values, sent))
          timers.current.set(
            key,
            setTimeout(() => void saveLine(key), 400),
          );
        return;
      }
      if (result.code === 'CONFLICT' && result.fresh) {
        const fresh = result.fresh;
        update(key, (item) => ({
          ...item,
          entry: fresh,
          values: valuesFromEntry(fresh),
          saved: valuesFromEntry(fresh),
          undo: null,
          status: 'stale',
          message: 'Someone else changed this row. Here is the new one.',
        }));
        return;
      }
      if (result.code === 'NETWORK_ERROR') offlineKeys.current.add(key);
      // The day gained work this grid did not show: load it, and keep this line for the person to check.
      if (result.code === 'CONFLICT') scheduleRefresh();
      update(key, (item) => ({ ...item, status: 'error', message: result.message }));
    },
    [canEdit, classById, grid.date, rowById, scheduleRefresh, update],
  );

  // A tablet on the floor drops its connection now and then. Rows that could not be sent go out
  // again when the browser is back online, and every few seconds until then.
  useEffect(() => {
    retryOffline.current = () => {
      for (const key of [...offlineKeys.current]) {
        const line = linesRef.current.find((item) => item.key === key);
        if (!line || line.status !== 'error') offlineKeys.current.delete(key);
        else void saveLine(key);
      }
    };
  }, [saveLine]);
  useEffect(() => {
    const run = () => retryOffline.current();
    const timer = setInterval(run, 6000);
    window.addEventListener('online', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', run);
    };
  }, []);

  const schedule = useCallback(
    (key: string, delay = 900) => {
      const pending = timers.current.get(key);
      if (pending) clearTimeout(pending);
      timers.current.set(
        key,
        setTimeout(() => void saveLine(key), delay),
      );
    },
    [saveLine],
  );

  const flush = useCallback(() => {
    for (const line of linesRef.current) if (line.status === 'dirty') void saveLine(line.key);
  }, [saveLine]);

  // Leaving the day (another date, another page): save what is still waiting.
  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      for (const line of linesRef.current) {
        if (line.status !== 'dirty' || lineProblem(line.values) || (!line.entry && isBlank(line.values)))
          continue;
        void fetch('/api/v1/log/rows', {
          method: 'PUT',
          keepalive: true,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: line.entry?.id ?? null,
            jobId: line.jobId,
            workDate: grid.date,
            shift: line.shift,
            version: line.entry?.version ?? null,
            seen: seenLines(linesRef.current, line.jobId),
            ...toPayload(line.values),
          }),
        }).catch(() => undefined);
      }
    };
  }, [grid.date]);

  const setField = useCallback(
    (key: string, field: LineField | 'setup', text: string) => {
      update(key, (line) => ({
        ...line,
        values: applyField(line.values, field, text),
        status: 'dirty',
        message: null,
      }));
      schedule(key);
    },
    [schedule, update],
  );

  const setClass = useCallback(
    (key: string, laborClassId: string | null) => {
      update(key, (line) => ({
        ...line,
        values: { ...line.values, laborClassId },
        status: 'dirty',
        message: null,
      }));
      schedule(key, 200);
    },
    [schedule, update],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const scoped = onlyJobs ? grid.rows.filter((row) => onlyJobs.includes(row.jobId)) : grid.rows;
    if (!q) return scoped;
    return scoped.filter((row) =>
      `${row.jobNumber} ${row.jobName} ${row.clientName}`.toLowerCase().includes(q),
    );
  }, [filter, grid.rows, onlyJobs]);

  const visibleLines = useMemo(
    () => filtered.flatMap((row) => lines.filter((line) => line.jobId === row.jobId)),
    [filtered, lines],
  );

  const focusCell = useCallback((key: string, field: LineField | 'setup'): boolean => {
    const el = container.current?.querySelector<HTMLInputElement>(
      `[data-line="${key}"][data-field="${field}"]`,
    );
    if (!el || el.disabled) return false;
    el.focus();
    el.select();
    return true;
  }, []);

  const move = useCallback(
    (key: string, field: LineField | 'setup', rows: number, cols: number): boolean => {
      const order = visibleLines.map((line) => line.key);
      let r = order.indexOf(key) + rows;
      const fields = LINE_FIELDS as readonly string[];
      const c = (field === 'setup' ? fields.indexOf('overtime') : fields.indexOf(field)) + cols;
      const target = LINE_FIELDS[c];
      if (!target) return false;
      while (r >= 0 && r < order.length) {
        if (focusCell(order[r]!, target)) return true;
        if (rows === 0) return false;
        r += rows;
      }
      return false;
    },
    [focusCell, visibleLines],
  );

  /** Applies many line changes in one all or nothing save, with an Undo toast. */
  const bulkApply = useCallback(
    async (changes: ReadonlyMap<string, LineValues>, done: (count: number) => string): Promise<number> => {
      const targets = linesRef.current.filter(
        (line) => changes.has(line.key) && !sameValues(changes.get(line.key)!, line.saved),
      );
      for (const line of targets) {
        const problem = lineProblem(changes.get(line.key)!);
        if (problem) {
          toast.error('Nothing was changed', `${rowById.get(line.jobId)?.jobNumber ?? 'A row'}: ${problem}`);
          return 0;
        }
      }
      const toSave = targets.filter((line) => line.entry || !isBlank(changes.get(line.key)!));
      if (toSave.length === 0) return 0;
      const before = new Map(toSave.map((line) => [line.key, { entry: line.entry, saved: line.saved }]));
      setLines((previous) =>
        previous.map((line) =>
          before.has(line.key)
            ? { ...line, values: changes.get(line.key)!, status: 'saving', message: null }
            : line,
        ),
      );
      const result = await saveProductionBulkAction({
        entries: toSave.map((line) => ({
          id: line.entry?.id ?? null,
          jobId: line.jobId,
          workDate: grid.date,
          shift: line.shift,
          version: line.entry?.version ?? null,
          ...toPayload(changes.get(line.key)!),
        })),
      });
      if (!result.ok) {
        setLines((previous) =>
          previous.map((line) =>
            before.has(line.key) ? { ...line, values: line.saved, status: 'idle', message: null } : line,
          ),
        );
        toast.error('Nothing was changed', result.error.message);
        return 0;
      }
      const saved = result.data.entries;
      setLines((previous) =>
        previous.map((line) => {
          const index = toSave.findIndex((item) => item.key === line.key);
          const entry = index >= 0 ? saved[index] : undefined;
          if (!entry) return line;
          const values = {
            ...valuesFromEntry(entry),
            hoursEach: changes.get(line.key)!.hoursEach || valuesFromEntry(entry).hoursEach,
          };
          return {
            ...line,
            entry,
            values,
            saved: values,
            undo: before.get(line.key)!.saved,
            status: 'saved',
            message: null,
          };
        }),
      );
      scheduleRefresh();
      toast.undo(done(toSave.length), {
        onUndo: async () => {
          const created = toSave
            .map((line, index) => ({ line, entry: saved[index] }))
            .filter((item) => !before.get(item.line.key)!.entry && item.entry);
          const edited = toSave
            .map((line, index) => ({ line, entry: saved[index] }))
            .filter((item) => before.get(item.line.key)!.entry && item.entry);
          if (created.length > 0) {
            const removed = await deleteProductionEntriesAction({
              ids: created.map((item) => item.entry!.id),
            });
            if (!removed.ok) throw new Error(removed.error.message);
          }
          let restored: readonly ProductionEntryDTO[] = [];
          if (edited.length > 0) {
            const back = await saveProductionBulkAction({
              entries: edited.map((item) => ({
                id: item.entry!.id,
                jobId: item.line.jobId,
                workDate: grid.date,
                shift: item.line.shift,
                version: item.entry!.version,
                ...toPayload(before.get(item.line.key)!.saved),
              })),
            });
            if (!back.ok) throw new Error(back.error.message);
            restored = back.data.entries;
          }
          setLines((previous) =>
            previous.map((line) => {
              const was = before.get(line.key);
              if (!was) return line;
              if (!was.entry)
                return {
                  ...line,
                  entry: null,
                  values: was.saved,
                  saved: was.saved,
                  undo: null,
                  status: 'idle',
                  message: null,
                };
              const entry = restored.find((item) => item.id === was.entry!.id) ?? was.entry;
              return { ...lineFromEntry(entry, line.key), showMore: line.showMore };
            }),
          );
          scheduleRefresh();
        },
      });
      return toSave.length;
    },
    [grid.date, rowById, scheduleRefresh, setLines],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>, key: string, field: LineField) => {
      const text = event.clipboardData.getData('text/plain');
      if (!isBlockPaste(text)) return;
      event.preventDefault();
      const block = parsePasted(text);
      const plan = planPaste(
        block,
        visibleLines
          .filter((line) => {
            if (linesRef.current.filter((other) => other.jobId === line.jobId)[0]?.key === line.key) return true;
            if (!line.entry) return false;
            // A column of units goes one job down each row: extra crew lines have no units cells to fill.
            const startsInUnits = field === 'unitsGood' || field === 'unitsScrap' || field === 'unitsRework';
            const showsUnits = (['unitsGood', 'unitsScrap', 'unitsRework'] as const).some(
              (name) => (parseTyped(line.values[name]) ?? 0) > 0,
            );
            return !startsInUnits || showsUnits;
          })
          .map((line) => ({ key: line.key, jobNumber: rowById.get(line.jobId)?.jobNumber ?? '' })),
        key,
        field,
      );
      const changes = new Map<string, LineValues>();
      for (const [lineKey, patch] of plan.changes) {
        const line = linesRef.current.find((item) => item.key === lineKey);
        if (!line) continue;
        let values = line.values;
        // Labor hours last, so a pasted total wins over people times hours each.
        const ordered = (Object.entries(patch) as [LineField, string][]).sort(
          ([a], [b]) => (a === 'hours' ? 1 : 0) - (b === 'hours' ? 1 : 0),
        );
        for (const [name, value] of ordered)
          values = applyField(values, name, name === 'note' ? value : value.replace(/[$,\s]/g, ''));
        changes.set(lineKey, values);
      }
      if (changes.size === 0) {
        toast.warning(
          'Nothing to paste here',
          plan.byJob
            ? 'None of the job numbers in the first column are on this day.'
            : 'The copied cells did not line up with any row.',
        );
        return;
      }
      void bulkApply(
        changes,
        (count) =>
          `Pasted into ${count} ${count === 1 ? 'row' : 'rows'}${plan.skipped > 0 ? `. ${plan.skipped} did not fit` : ''}`,
      );
    },
    [bulkApply, rowById, visibleLines],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, key: string, field: LineField | 'setup') => {
      const input = event.currentTarget;
      if (event.key === 'Enter') {
        event.preventDefault();
        void saveLine(key);
        move(key, field, event.shiftKey ? -1 : 1, 0);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(key, field, event.key === 'ArrowDown' ? 1 : -1, 0);
      } else if (event.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
        if (move(key, field, 0, -1)) event.preventDefault();
      } else if (
        event.key === 'ArrowRight' &&
        input.selectionStart === input.value.length &&
        input.selectionEnd === input.value.length
      ) {
        if (move(key, field, 0, 1)) event.preventDefault();
      } else if (event.key === 'Escape') {
        const line = linesRef.current.find((item) => item.key === key);
        if (line && (!sameValues(line.values, line.saved) || line.status === 'error' || line.status === 'dirty')) {
          event.preventDefault();
          const pending = timers.current.get(key);
          if (pending) clearTimeout(pending);
          update(key, (item) => ({
            ...item,
            values: { ...item.saved, hoursEach: valuesHoursEach(item.saved) },
            status: 'idle',
            message: null,
          }));
        }
      } else if (
        (event.key === 'd' || event.key === 'D') &&
        (event.metaKey || event.ctrlKey) &&
        field !== 'setup'
      ) {
        event.preventDefault();
        const order = visibleLines.map((line) => line.key);
        const above = visibleLines[order.indexOf(key) - 1];
        if (above) setField(key, field, above.values[field]);
      }
    },
    [move, saveLine, setField, update, visibleLines],
  );

  const addLine = useCallback(
    (row: LogGridRowDTO, copyFrom?: Line) => {
      const used = new Set(
        linesRef.current.filter((line) => line.jobId === row.jobId).map((line) => line.values.laborClassId),
      );
      const next = liveClasses.find((item) => !used.has(item.id));
      if (!next) {
        toast.info(
          'Every labor class already has a line',
          'Add a labor class under Labor, Rates, then come back.',
        );
        return;
      }
      const line = draftLine(
        row,
        next.id,
        copyFrom
          ? {
              people: copyFrom.values.people,
              hoursEach: copyFrom.values.hoursEach,
              hours: copyFrom.values.hours,
            }
          : {},
      );
      setLines((previous) => {
        const last = previous.map((item) => item.jobId).lastIndexOf(row.jobId);
        return [
          ...previous.slice(0, last + 1),
          copyFrom ? { ...line, status: 'dirty' } : line,
          ...previous.slice(last + 1),
        ];
      });
      if (copyFrom) schedule(line.key, 300);
      // The menu hands focus back to its button when it closes. `onCloseAutoFocus` sends it to the new line instead.
      pendingFocus.current = line.key;
    },
    [liveClasses, schedule, setLines],
  );

  const fillUsualCrew = useCallback(
    async (row: LogGridRowDTO) => {
      const current = linesRef.current.filter((line) => line.jobId === row.jobId);
      const changes = new Map<string, LineValues>();
      const added: Line[] = [];
      row.usualCrew.forEach((crew, index) => {
        const people = tidy(crew.headcount);
        const filled = (base: LineValues) =>
          applyField(
            applyField({ ...base, laborClassId: crew.laborClassId }, 'people', people),
            'hoursEach',
            tidy(grid.shiftHours),
          );
        const match =
          current.find((line) => line.values.laborClassId === crew.laborClassId) ??
          (index === 0 ? current.find((line) => !line.entry && isBlank(line.values)) : undefined);
        if (match) changes.set(match.key, filled(match.values));
        else {
          const line = draftLine(row, crew.laborClassId);
          added.push(line);
          changes.set(line.key, filled(line.values));
        }
      });
      if (added.length > 0) {
        setLines((previous) => {
          const last = previous.map((item) => item.jobId).lastIndexOf(row.jobId);
          return [...previous.slice(0, last + 1), ...added, ...previous.slice(last + 1)];
        });
      }
      await bulkApply(changes, () => `Filled the usual crew for ${row.jobNumber}`);
    },
    [bulkApply, grid.shiftHours, setLines],
  );

  const clearLine = useCallback(
    async (line: Line) => {
      if (!line.entry) {
        setLines((previous) => {
          const siblings = previous.filter((item) => item.jobId === line.jobId);
          if (siblings.length <= 1)
            return previous.map((item) =>
              item.key === line.key
                ? {
                    ...item,
                    values: { ...EMPTY_VALUES, laborClassId: item.values.laborClassId },
                    status: 'idle',
                    message: null,
                  }
                : item,
            );
          return previous.filter((item) => item.key !== line.key);
        });
        return;
      }
      const entry = line.entry;
      const result = await deleteProductionEntriesAction({ ids: [entry.id] });
      if (!result.ok) {
        toast.error("Couldn't clear the row", result.error.message);
        return;
      }
      setLines((previous) => {
        const siblings = previous.filter((item) => item.jobId === line.jobId);
        if (siblings.length <= 1)
          return previous.map((item) =>
            item.key === line.key
              ? {
                  ...item,
                  entry: null,
                  values: { ...EMPTY_VALUES, laborClassId: item.values.laborClassId },
                  saved: { ...EMPTY_VALUES, laborClassId: item.values.laborClassId },
                  undo: null,
                  status: 'idle',
                  message: null,
                }
              : item,
          );
        return previous.filter((item) => item.key !== line.key);
      });
      scheduleRefresh();
      toast.undo(`Cleared ${rowById.get(line.jobId)?.jobNumber ?? 'the row'}`, {
        onUndo: async () => {
          const back = await restoreProductionEntriesAction({ ids: [entry.id] });
          if (!back.ok) throw new Error(back.error.message);
          await queryClient.invalidateQueries({ queryKey: qk.streams() });
        },
      });
    },
    [queryClient, rowById, scheduleRefresh, setLines],
  );

  useEffect(() => {
    clearLineRef.current = clearLine;
  }, [clearLine]);

  const undoLine = useCallback(
    (line: Line) => {
      if (!line.undo) return;
      const back = line.undo;
      update(line.key, (item) => ({
        ...item,
        values: { ...back, hoursEach: valuesHoursEach(back) },
        status: 'dirty',
        message: null,
      }));
      schedule(line.key, 50);
    },
    [schedule, update],
  );

  useImperativeHandle(
    ref,
    () => ({
      flush,
      focusJob: (jobId: string) => {
        const line = linesRef.current.find((item) => item.jobId === jobId);
        if (line) focusCell(line.key, 'unitsGood');
      },
      copyCrew: async (crew) => {
        const changes = new Map<string, LineValues>();
        const added: { row: LogGridRowDTO; line: Line }[] = [];
        let jobs = 0;
        for (const previous of crew) {
          const row = rowById.get(previous.jobId);
          if (!row) continue;
          const current = linesRef.current.filter((line) => line.jobId === row.jobId);
          if (current.some((line) => (parseTyped(line.values.hours) ?? 0) > 0)) continue;
          jobs += 1;
          // The biggest crew goes first, so the main line (the one that holds the units) keeps its
          // labor class and a helper such as a line lead lands on a line of its own.
          const crewLines = [...previous.lines].sort(
            (a, b) => Number(b.hours) - Number(a.hours),
          );
          const wanted = new Set(crewLines.map((item) => item.laborClassId));
          crewLines.forEach((crewLine, index) => {
            const fill = (base: LineValues): LineValues =>
              applyField(
                { ...base, laborClassId: crewLine.laborClassId, people: tidy(crewLine.headcount) },
                'hours',
                tidy(crewLine.hours),
              );
            const first = current[0];
            const match =
              current.find((line) => line.values.laborClassId === crewLine.laborClassId) ??
              (index === 0 && first && (!first.entry || !wanted.has(first.values.laborClassId))
                ? first
                : undefined);
            if (match && !changes.has(match.key)) changes.set(match.key, fill(match.values));
            else {
              const line = draftLine(row, crewLine.laborClassId);
              added.push({ row, line });
              changes.set(line.key, fill(line.values));
            }
          });
        }
        if (added.length > 0) {
          setLines((previous) => {
            let next = previous;
            for (const item of added) {
              const last = next.map((line) => line.jobId).lastIndexOf(item.row.jobId);
              next = [...next.slice(0, last + 1), item.line, ...next.slice(last + 1)];
            }
            return next;
          });
        }
        if (changes.size === 0) return 0;
        const saved = await bulkApply(
          changes,
          () => `Copied the crew for ${jobs} ${jobs === 1 ? 'job' : 'jobs'}`,
        );
        return saved > 0 ? jobs : 0;
      },
    }),
    [bulkApply, flush, focusCell, rowById, setLines],
  );

  // Day totals, from what is on screen right now.
  const totals = useMemo<GridTotals>(() => {
    let units = 0;
    let hours = 0;
    let people = 0;
    const logged = new Set<string>();
    for (const line of lines) {
      const u = parseTyped(line.values.unitsGood) ?? 0;
      const h = parseTyped(line.values.hours) ?? 0;
      units += u;
      hours += h;
      people += parseTyped(line.values.people) ?? 0;
      if (u > 0 || h > 0) logged.add(line.jobId);
    }
    const entries = lines
      .map((line) => line.entry)
      .filter((entry): entry is ProductionEntryDTO => Boolean(entry));
    return {
      units,
      hours,
      people,
      jobsLogged: logged.size,
      jobs: grid.rows.length,
      money: seesMoney ? moneyReadout(entries) : null,
      unsaved: lines.filter(
        (line) => line.status === 'dirty' || line.status === 'saving' || line.status === 'error',
      ).length,
      stuck: lines.filter((line) => line.status === 'error').length,
    };
  }, [grid.rows.length, lines, seesMoney]);

  useEffect(() => {
    onTotals?.(totals);
  }, [onTotals, totals]);

  return (
    <div ref={container} data-testid="log-grid" className="flex flex-col">
      <div
        aria-hidden
        className={cn(
          'hidden items-end gap-1 border-b border-border-default px-3 pb-2 text-xs font-medium text-fg-muted xl:grid',
          COLS,
        )}
      >
        <span>Job</span>
        <span className="pr-2 text-right">Units good</span>
        <span className="pr-2 text-right">Scrap</span>
        <span className="pr-2 text-right">Rework</span>
        <span className="pl-2">Labor class</span>
        <span className="pr-2 text-right">People</span>
        <span className="pr-2 text-right">Hours each</span>
        <span className="pr-2 text-right">Labor hours</span>
        <span className="pr-2 text-right">Overtime</span>
        <span className="pl-2">Note</span>
        <span className="pl-1">Today</span>
        <span className="sr-only">Saved</span>
      </div>
      {filtered.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-fg-muted">
          No job on this day matches “{filter.trim()}”.
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {filtered.map((row) => {
          const jobLines = lines.filter((line) => line.jobId === row.jobId);
          const readout = rowReadout(
            row,
            jobLines.map((line) => line.values),
            grid.shiftHours,
            thresholds,
          );
          const entries = jobLines
            .map((line) => line.entry)
            .filter((entry): entry is ProductionEntryDTO => Boolean(entry));
          const money = seesMoney ? moneyReadout(entries) : null;
          const settling = jobLines.some((line) => line.status === 'dirty' || line.status === 'saving');
          return (
            <li key={row.jobId} data-testid={`log-row-${row.jobNumber}`} className="px-3 py-3 xl:py-1.5">
              {jobLines.map((line, index) => {
                const first = index === 0;
                const question = crewQuestion(line.values, grid.shiftHours);
                const disabled = !canEdit || Boolean(line.entry?.locked);
                const label = (field: LineField | 'setup') =>
                  `${FIELD_LABELS[field]} for ${row.jobNumber}${first ? '' : `, ${classById.get(line.values.laborClassId ?? '')?.name ?? 'crew line'}`}`;
                const showUnits =
                  first ||
                  (parseTyped(line.values.unitsGood) ?? 0) > 0 ||
                  (parseTyped(line.values.unitsScrap) ?? 0) > 0 ||
                  (parseTyped(line.values.unitsRework) ?? 0) > 0;
                const input = (
                  field: LineField,
                  extra?: { placeholder?: string; className?: string; text?: boolean },
                ) => (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-xs text-fg-muted xl:sr-only">{FIELD_LABELS[field]}</span>
                    <input
                      data-line={line.key}
                      data-field={field}
                      aria-label={label(field)}
                      aria-invalid={line.status === 'error' || undefined}
                      inputMode={extra?.text ? 'text' : 'decimal'}
                      autoComplete="off"
                      disabled={disabled}
                      value={line.values[field]}
                      placeholder={extra?.placeholder}
                      onChange={(event) => setField(line.key, field, event.target.value)}
                      onKeyDown={(event) => onKeyDown(event, line.key, field)}
                      onPaste={(event) => onPaste(event, line.key, field)}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={(event) => {
                        const next = event.relatedTarget as HTMLElement | null;
                        if (next?.getAttribute('data-line') !== line.key) void saveLine(line.key);
                      }}
                      className={cn(cellInput, extra?.text && 'text-left', extra?.className)}
                    />
                  </label>
                );
                return (
                  <div
                    key={line.key}
                    className={cn(
                      'grid grid-cols-3 gap-x-2 gap-y-2 sm:grid-cols-4 md:grid-cols-9 xl:items-center xl:gap-1',
                      COLS,
                      !first &&
                        'mt-2 border-t border-dashed border-border-subtle pt-2 xl:mt-1 xl:border-0 xl:pt-0',
                    )}
                  >
                    <div className="col-span-full min-w-0 xl:col-span-1">
                      {first ? (
                        <div className="flex min-w-0 flex-col">
                          <Link
                            href={routes.job(row.jobNumber)}
                            className="truncate text-sm font-medium text-fg hover:text-fg-link hover:underline"
                            title={`${row.jobNumber} ${row.jobName}`}
                          >
                            <span className="tabular-nums text-fg-secondary">{row.jobNumber}</span>{' '}
                            {row.jobName}
                          </Link>
                          <span className="truncate text-xs text-fg-muted">
                            {row.clientName}
                            {Number(row.plannedUnits) > 0
                              ? `, ${formatNumber(row.unitsDone, { maxDigits: 0 })} of ${formatNumber(row.plannedUnits, { maxDigits: 0 })} ${row.unitLabel} done`
                              : ''}
                          </span>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-fg-muted xl:justify-end xl:pr-2">
                          <Users aria-hidden className="size-3.5" /> Crew line {index + 1}
                        </span>
                      )}
                    </div>
                    {showUnits ? (
                      input('unitsGood', { placeholder: '0' })
                    ) : (
                      <span className="hidden xl:block" />
                    )}
                    {showUnits ? input('unitsScrap') : <span className="hidden xl:block" />}
                    {showUnits ? input('unitsRework') : <span className="hidden xl:block" />}
                    <label className="flex min-w-0 flex-col gap-1 md:col-span-2 xl:col-span-1">
                      <span className="text-xs text-fg-muted xl:sr-only">Labor class</span>
                      <ClassSelect
                        label={`Labor class for ${row.jobNumber}, line ${index + 1}`}
                        disabled={disabled}
                        value={line.values.laborClassId}
                        laborClasses={laborClasses}
                        taken={lines
                          .filter((other) => other.key !== line.key && other.jobId === line.jobId && other.shift === line.shift)
                          .map((other) => other.values.laborClassId ?? row.defaultLaborClassId ?? '')
                          .join(',')}
                        lineKey={line.key}
                        onChange={setClass}
                      />
                    </label>
                    {input('people')}
                    {/* No grey number here: a placeholder that looks like 8 reads as 8 hours typed in. */}
                    {input('hoursEach')}
                    {input('hours', { className: 'font-medium' })}
                    {input('overtime')}
                    <div
                      className={cn('col-span-1 xl:col-span-1', first ? 'sm:col-span-3 md:col-span-4' : 'sm:col-span-2')}
                    >
                      {input('note', { text: true, placeholder: 'Add a note' })}
                    </div>
                    <div
                      className={cn(
                        'min-w-0 xl:col-span-1',
                        first ? 'col-span-full sm:col-span-3 md:col-span-4 md:self-end xl:self-center xl:pl-1' : 'hidden xl:block',
                      )}
                    >
                      {first ? (
                        <Readout
                          row={row}
                          readout={readout}
                          money={money}
                          settling={settling}
                          lines={jobLines}
                          classById={classById}
                        />
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        'flex items-center justify-end gap-1 xl:col-span-1',
                        'col-span-full sm:col-span-1 md:self-end',
                      )}
                    >
                      <LineState line={line} onUndo={() => undoLine(line)} disabled={disabled} />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            label={`More for ${row.jobNumber}`}
                            icon={<MoreHorizontal aria-hidden />}
                            size="sm"
                            variant="ghost"
                            disabled={disabled}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onCloseAutoFocus={(event) => {
                            const key = pendingFocus.current;
                            pendingFocus.current = null;
                            if (key && focusCell(key, 'people')) event.preventDefault();
                          }}
                        >
                          <DropdownMenuItem icon={<Plus aria-hidden />} onSelect={() => addLine(row)}>
                            Add a crew line
                          </DropdownMenuItem>
                          <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={() => addLine(row, line)}>
                            Duplicate this line
                          </DropdownMenuItem>
                          {row.usualCrew.length > 0 ? (
                            <DropdownMenuItem
                              icon={<Users aria-hidden />}
                              onSelect={() => void fillUsualCrew(row)}
                            >
                              Fill the usual crew
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            icon={<Wrench aria-hidden />}
                            onSelect={() =>
                              update(line.key, (item) => ({ ...item, showMore: !item.showMore }))
                            }
                          >
                            {line.showMore ? 'Hide setup hours' : 'Setup hours'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            icon={<Trash2 aria-hidden />}
                            variant="danger"
                            onSelect={() => void clearLine(line)}
                          >
                            Clear this line
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {line.showMore ? (
                      <div className="col-span-full flex flex-wrap items-end gap-3 rounded-md bg-sunken px-3 py-2 xl:ml-[200px]">
                        <label className="flex w-28 flex-col gap-1">
                          <span className="text-xs text-fg-muted">Setup hours</span>
                          <input
                            data-line={line.key}
                            data-field="setup"
                            aria-label={label('setup')}
                            inputMode="decimal"
                            disabled={disabled}
                            value={line.values.setup}
                            onChange={(event) => setField(line.key, 'setup', event.target.value)}
                            onKeyDown={(event) => onKeyDown(event, line.key, 'setup')}
                            onBlur={() => void saveLine(line.key)}
                            className={cellInput}
                          />
                        </label>
                        <p className="max-w-md pb-1 text-xs text-fg-muted">
                          Setup hours are part of the labor hours. They cost the same, but they do not count
                          in the pace, so a setup day does not make the job look slow.
                        </p>
                      </div>
                    ) : null}
                    {line.message || question ? (
                      <p
                        role={line.status === 'error' ? 'alert' : 'status'}
                        className={cn(
                          'col-span-full flex items-start gap-1.5 text-xs xl:pl-[204px]',
                          line.status === 'error' ? 'text-danger-text' : 'text-warning-text',
                        )}
                      >
                        <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
                        <span>
                          {line.message ?? question}
                          {line.status === 'error' && line.message && !lineProblem(line.values) ? (
                            <button
                              type="button"
                              className="ml-2 rounded-sm font-medium text-fg underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                              onClick={() => void saveLine(line.key)}
                            >
                              Try again
                            </button>
                          ) : null}
                        </span>
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
    </div>
  );
});

/** "4,576 kits": the job's own unit word, which is already plural. */
function units(value: number, unitLabel: string): string {
  return `${formatNumber(value, { maxDigits: 1 })} ${unitLabel}`;
}

function valuesHoursEach(values: LineValues): string {
  return applyField(values, 'hours', values.hours).hoursEach;
}

function LineState({
  line,
  onUndo,
  disabled,
}: {
  readonly line: Line;
  readonly onUndo: () => void;
  readonly disabled: boolean;
}) {
  return (
    <span className="flex min-h-7 items-center gap-1 text-xs" aria-live="polite">
      {line.status === 'saving' ? (
        <span className="flex items-center gap-1 text-fg-muted">
          <Loader2 aria-hidden className="size-3.5 animate-spin" /> <span className="xl:sr-only">Saving</span>
        </span>
      ) : line.status === 'dirty' ? (
        <span className="flex items-center gap-1 text-fg-muted">
          <CircleDashed aria-hidden className="size-3.5" /> <span className="xl:sr-only">Not saved yet</span>
        </span>
      ) : line.status === 'saved' ? (
        <span data-testid="saved-tick" className="flex items-center gap-1 text-success-text">
          <Check aria-hidden className="size-3.5" /> <span className="xl:sr-only">Saved</span>
        </span>
      ) : line.status === 'error' ? (
        <span className="flex items-center gap-1 text-danger-text">
          <AlertTriangle aria-hidden className="size-3.5" /> <span className="xl:sr-only">Not saved</span>
        </span>
      ) : null}
      {line.undo && (line.status === 'saved' || line.status === 'idle') && !disabled ? (
        <IconButton
          label="Undo the last change to this line"
          icon={<RotateCcw aria-hidden />}
          size="sm"
          variant="ghost"
          onClick={onUndo}
        />
      ) : null}
    </span>
  );
}

const TONE: Readonly<Record<RowReadout['tone'], { className: string; words: string }>> = {
  good: { className: 'bg-success-subtle text-success-text', words: 'On pace' },
  watch: { className: 'bg-warning-subtle text-warning-text', words: 'A bit slow' },
  bad: { className: 'bg-danger-subtle text-danger-text', words: 'Too slow' },
  none: { className: 'bg-muted text-fg-secondary', words: '' },
};

function Readout({
  row,
  readout,
  money,
  settling,
  lines,
  classById,
}: {
  readonly row: LogGridRowDTO;
  readonly readout: RowReadout;
  readonly money: MoneyReadout | null;
  readonly settling: boolean;
  readonly lines: readonly Line[];
  readonly classById: ReadonlyMap<string, LaborClassDTO>;
}) {
  const tone = TONE[readout.tone];
  const hasWork = readout.units > 0 || readout.hours > 0;
  if (!hasWork) {
    return (
      <p className="text-xs text-fg-muted">
        {readout.targetUph ? `Target pace ${formatPace(readout.targetUph, { empty: '', withWords: true })}` : 'No target pace yet'}
        {readout.goalUnits ? `. Goal ${units(readout.goalUnits, row.unitLabel)}` : ''}
      </p>
    );
  }
  const missingHours = readout.units > 0 && readout.paceHours <= 0;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {missingHours ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-xs font-medium text-warning-text">
              <AlertTriangle aria-hidden className="size-3" /> {missingLaborWords(lines.map((line) => line.values))}
            </span>
          ) : readout.uph === null ? (
            <span className="text-xs text-fg-muted">
              {formatHours(readout.hours, { empty: '', style: 'unit' })} logged, no units yet
            </span>
          ) : (
            <span
              data-testid="pace-chip"
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums',
                tone.className,
              )}
            >
              {readout.tone === 'good' ? (
                <TrendingUp aria-hidden className="size-3" />
              ) : readout.tone === 'none' ? null : (
                <TrendingDown aria-hidden className="size-3" />
              )}
              {formatNumber(readout.uph, { maxDigits: 1 })}
              {readout.targetUph ? ` of ${formatNumber(readout.targetUph, { maxDigits: 1 })}` : ''} an hour
              {tone.words ? <span className="font-normal">{`· ${tone.words}`}</span> : null}
            </span>
          )}
        </div>
        {money ? (
          <p
            className={cn(
              'text-xs tabular-nums text-fg-secondary transition-opacity xl:truncate',
              settling && 'opacity-50',
            )}
          >
            Labor {formatMoney(money.laborCents)}
            {money.jobsNoHours > 0 ? (
              <span data-testid="row-no-margin">, no margin yet: add the hours</span>
            ) : money.marginBp !== null ? (
              <>
                , margin{' '}
                <span className={cn('font-medium', money.profitCents < 0 ? 'text-danger-text' : 'text-fg')}>
                  {formatPercentBp(money.marginBp)}
                </span>
              </>
            ) : money.revenueCents === 0 && money.laborCents > 0 ? (
              ', no revenue yet'
            ) : null}
          </p>
        ) : readout.goalUnits ? (
          <p className="truncate text-xs text-fg-muted">
            Goal {units(readout.goalUnits, row.unitLabel)},{' '}
            {formatPercentBp(Math.round((readout.units / readout.goalUnits) * 10000), { digits: 0 })} there
          </p>
        ) : null}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <IconButton
            label={`How we got the numbers for ${row.jobNumber}`}
            icon={<Info aria-hidden />}
            size="sm"
            variant="ghost"
          />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={12}
          side="left"
          className="w-[340px] max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain"
        >
          <HowWeGotThis row={row} readout={readout} money={money} lines={lines} classById={classById} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Step({
  label,
  value,
  hint,
  strong,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="min-w-0 text-sm text-fg-secondary">
        {label}
        {hint ? <span className="block text-xs text-fg-muted">{hint}</span> : null}
      </dt>
      <dd className={cn('shrink-0 text-sm tabular-nums text-fg', strong && 'font-semibold')}>{value}</dd>
    </div>
  );
}

function HowWeGotThis({
  row,
  readout,
  money,
  lines,
  classById,
}: {
  readonly row: LogGridRowDTO;
  readonly readout: RowReadout;
  readonly money: MoneyReadout | null;
  readonly lines: readonly Line[];
  readonly classById: ReadonlyMap<string, LaborClassDTO>;
}) {
  const setup = readout.hours - readout.paceHours;
  return (
    <div className="flex flex-col gap-2" data-testid="how-we-got-this">
      <h3 className="text-sm font-semibold text-fg">How we got this</h3>
      <dl className="divide-y divide-border-subtle">
        <Step label="Units good" value={units(readout.units, row.unitLabel)} />
        <Step
          label="Labor hours"
          value={formatHours(readout.hours)}
          hint={
            setup > 0
              ? `${formatHours(setup)} of setup do not count in the pace`
              : 'People times hours each, added up over the crew lines'
          }
        />
        <Step
          label="Pace"
          value={readout.uph === null ? 'No pace yet' : formatPace(readout.uph)}
          hint="Units good divided by labor hours"
        />
        <Step
          label="Target pace"
          value={readout.targetUph === null ? 'None set' : formatPace(readout.targetUph)}
          hint={
            readout.productivityBp !== null
              ? `This day is at ${formatPercentBp(readout.productivityBp, { digits: 0 })} of the target`
              : undefined
          }
        />
        {readout.goalUnits ? (
          <Step
            label="Goal for the day"
            value={units(readout.goalUnits, row.unitLabel)}
            hint="The usual crew for one shift at the target pace"
          />
        ) : null}
      </dl>
      {money ? (
        <>
          <h4 className="mt-1 text-xs font-medium tracking-wide text-fg-muted uppercase">Money today</h4>
          <dl className="divide-y divide-border-subtle">
            <Step
              label="Earned"
              value={formatMoney(money.revenueCents)}
              hint="Units good times the price for each unit"
            />
            {lines
              .filter((line) => line.entry && (line.entry.laborCostCents ?? 0) !== 0)
              .map((line) => (
                <Step
                  key={line.key}
                  label={`Labor, ${classById.get(line.entry!.laborClassId ?? '')?.name ?? 'default class'}`}
                  value={formatMoney(line.entry!.laborCostCents)}
                  hint={`${formatHours(line.entry!.hours)} at ${formatMoneyPerHour(line.entry!.rateCents)}, the real cost of an hour${Number(line.entry!.overtimeHours) > 0 ? ', overtime costs more' : ''}`}
                />
              ))}
            {money.materialCents !== 0 ? (
              <Step
                label="Materials"
                value={formatMoney(money.materialCents)}
                hint="Units times the planned material cost for each unit"
              />
            ) : null}
            {money.sharedCents !== 0 ? (
              <Step
                label="Time not on a job"
                value={formatMoney(money.sharedCents)}
                hint="This job's share of meetings, cleanup and waiting"
              />
            ) : null}
            <Step
              label="Profit today"
              value={formatMoney(money.profitCents)}
              hint="Earned minus labor, materials and the share"
              strong
            />
            <Step
              label="Margin today"
              value={money.jobsNoHours > 0 ? 'No margin yet' : money.marginBp === null ? 'No revenue yet' : formatPercentBp(money.marginBp)}
              hint={money.jobsNoHours > 0 ? 'There are units and no labor hours, so the labor cost is not in yet' : 'Profit divided by earned'}
              strong
            />
          </dl>
          <p className="text-xs text-fg-muted">
            Money comes from the saved row. It updates a moment after you stop typing.
          </p>
        </>
      ) : null}
    </div>
  );
}
