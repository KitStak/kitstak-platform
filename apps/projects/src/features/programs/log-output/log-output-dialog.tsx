'use client';
/**
 * Log output (docs/programs/SPEC.md 5.9): `?log=YYYY-MM-DD[&run=][&builds=][&step=close][&pkey=]`.
 * The fastest way to enter a day's numbers for many builds and to end the day cleanly:
 *
 * - Header: program chip, the day (arrows and a calendar; future and closed days refused), Show
 *   (This run, Today's builds, All open builds).
 * - Scan bar ("/" focuses it): a build key, SKU or variant key focuses that row; "Count each
 *   scan" adds one pack per scan; unknown codes offer Add a row.
 * - A grid of builds: Built today (Enter next row, Shift Enter previous, "=" fills the rest), Add
 *   or Set, Remaining after, Scrap (behind Show scrap), Done, Note. Add a row makes an unplanned
 *   build. Fill all fills every row to plan, with Undo.
 * - Footer totals with money, an over plan warning, Save (Mod Enter) and Save and close the day,
 *   which opens the second pane: Close short (reason), Move the rest to the next work day, or
 *   Leave open. Both panes go in one `logOutputAction` batch with Undo.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, ClipboardPen, Lock, MessageSquareText, Plus, ScanLine, Undo2, X } from 'lucide-react';
import { addDays, formatQty, fromScaled, quantityToScaled, shortDate, unitLabel } from '@kitstak/programs-engine';
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  IconButton,
  Input,
  IsoDatePicker,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Switch,
  ToggleGroup,
  Tooltip,
  cn,
  toast,
  useModKey,
} from '@/components/ui';
import { StatusIcon } from '@/components/pm';
import { useOutputSheet, useProgram, useVariants, programInvalidations } from '@/lib/hooks/use-programs';
import type { IsoDate, OutputSheetDTO, OutputSheetRow } from '@/lib/program-types';
import { logOutputAction, undoLogOutputAction } from '@/server/actions/output';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ProgramChip, VariantChip } from '../kit/chips';
import { MoneyText } from '../kit/numbers';
import { OutputCell } from '../kit/output-cell';
import { readQty, remainingText, trimQty } from '../kit/qty-input';
import { dayLabel, qtyOfText } from '../kit/format';
import { addScan, closeDayCandidates, emptyDraft, entriesFor, isCarried, isDirty, matchScan, overPlanBy, remainingAfter, totalsFor, visibleRows, willBeDone, type NewRow, type RowDraft, type ShowMode } from './log-model';

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly message: string; readonly code?: string } };
type Undo = Parameters<typeof undoLogOutputAction>[0]['undo'];

type Decision = { action: 'close_short' | 'move_rest' | 'leave_open'; reason: string; toDate: IsoDate };

const SCAN_PREF = 'ks-programs:count-each-scan';
const REASONS_PREF = 'ks-programs:short-reasons';

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the choice then lasts for this dialog only.
  }
}

export interface LogOutputDialogProps {
  readonly programKey: string;
  readonly date: IsoDate;
  readonly runId: string | null;
  readonly buildIds: readonly string[] | null;
  readonly startOnClose: boolean;
  readonly onDateChange: (date: IsoDate) => void;
  readonly onClose: () => void;
}

export function LogOutputDialog(props: LogOutputDialogProps) {
  const { programKey } = props;
  const program = useProgram(programKey, { staleTime: 30_000 });
  const variants = useVariants(programKey, false, { staleTime: 60_000 });
  const sheet = useOutputSheet(programKey, props.date, null, { staleTime: 0 });
  const [dirty, setDirty] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);

  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else props.onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent
          size="xl"
          hideClose
          aria-describedby={undefined}
          className="max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
          onEscapeKeyDown={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[role="listbox"],[data-radix-popper-content-wrapper]')) return;
            event.preventDefault();
            requestClose();
          }}
          data-testid="log-output-dialog"
        >
          {(program.data || program.isError) && sheet.data ? (
            <LogBody {...props} sheet={sheet.data} program={program.data ? logProgramOf(program.data) : projectLogProgram(programKey, sheet.data)} variants={variants.data ?? []} refetch={() => sheet.refetch()} onDirtyChange={setDirty} saveRef={saveRef} requestClose={requestClose} />
          ) : sheet.isError ? (
            <div className="flex flex-1 flex-col">
              <Header title="Log output" onClose={props.onClose} />
              <EmptyState illustration="error" title="We couldn't load the output sheet" description={sheet.error?.message ?? 'Check your connection, then try again.'} actions={<Button onClick={() => void sheet.refetch()}>Try again</Button>} className="flex-1" />
            </div>
          ) : (
            <LoadingBody onClose={props.onClose} />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent size="sm" hideClose role="alertdialog" data-testid="log-unsaved">
          <DialogHeader title={`Save ${dirty} ${dirty === 1 ? 'change' : 'changes'} before closing?`} description="The numbers you typed are not saved yet." />
          <DialogFooter className="border-t-0 pt-2">
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>
              Keep editing
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmClose(false);
                props.onClose();
              }}
              data-testid="log-discard"
            >
              Discard
            </Button>
            <Button
              loading={closing}
              onClick={async () => {
                setClosing(true);
                const ok = await saveRef.current();
                setClosing(false);
                setConfirmClose(false);
                if (ok) props.onClose();
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** What the dialog needs about the container: a program, or a plain project with builds. */
interface LogProgram {
  readonly key: string;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly unit: { readonly singular: string; readonly plural: string };
  readonly moneyHidden: boolean;
  readonly capabilities: { readonly canLog: boolean };
  readonly settings: { readonly autoDoneWhenFull: boolean };
  readonly calendar: { readonly today: IsoDate };
}

function logProgramOf(program: NonNullable<ReturnType<typeof useProgram>['data']>): LogProgram {
  return program;
}

/** A project that holds builds (no program): units, the server decides who may log. */
function projectLogProgram(key: string, sheet: OutputSheetDTO): LogProgram {
  const local = new Date();
  const today = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  return { key, name: key, color: null, icon: null, unit: { singular: 'unit', plural: 'units' }, moneyHidden: sheet.moneyHidden, capabilities: { canLog: true }, settings: { autoDoneWhenFull: true }, calendar: { today: sheet.date > today ? sheet.date : today } };
}

function Header({ title, onClose, children }: { readonly title: string; readonly onClose: () => void; readonly children?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-5 py-3.5 max-sm:px-4">
      <ClipboardPen aria-hidden className="size-5 text-icon" />
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {children}
      <IconButton label="Close" icon={<X aria-hidden />} size="sm" onClick={onClose} className="ml-auto" />
    </div>
  );
}

function LoadingBody({ onClose }: { readonly onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col" aria-busy="true" aria-label="Loading the output sheet">
      <Header title="Log output" onClose={onClose} />
      <div className="flex flex-col gap-2 px-5 py-4">
        <Skeleton height={36} rounded="md" />
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="flex h-12 items-center gap-4 border-b border-border-subtle">
            <Skeleton width={160} height={12} rounded="full" />
            <Skeleton width={60} height={12} rounded="full" />
            <span className="flex-1" />
            <Skeleton width={80} height={30} rounded="md" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface BodyProps extends LogOutputDialogProps {
  readonly sheet: OutputSheetDTO;
  readonly program: LogProgram;
  readonly variants: NonNullable<ReturnType<typeof useVariants>['data']>;
  readonly refetch: () => Promise<unknown>;
  readonly onDirtyChange: (changes: number) => void;
  readonly saveRef: React.MutableRefObject<() => Promise<boolean>>;
  readonly requestClose: () => void;
}

function LogBody({ programKey, date, runId, buildIds, startOnClose, onDateChange, onClose, sheet, program, variants, refetch, onDirtyChange, saveRef }: BodyProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mod = useModKey();
  const unit = program.unit;
  const moneyHidden = sheet.moneyHidden || program.moneyHidden;
  const canLog = program.capabilities.canLog;
  const autoDone = program.settings.autoDoneWhenFull;
  const today = program.calendar.today;
  const runRows = runId ? sheet.rows.filter((row) => row.runId === runId) : [];
  const [show, setShow] = useState<ShowMode>(runId && runRows.length ? 'run' : 'today');
  const [drafts, setDrafts] = useState<Map<string, RowDraft>>(new Map());
  const [added, setAdded] = useState<NewRow[]>([]);
  const [fillUndo, setFillUndo] = useState<Map<string, RowDraft> | null>(null);
  const [showScrap, setShowScrap] = useState(false);
  const [pane, setPane] = useState<'log' | 'close'>(startOnClose ? 'close' : 'log');
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<Map<string, string>>(new Map());
  const [scan, setScan] = useState('');
  const [scanMiss, setScanMiss] = useState<{ text: string; variantId: string | null } | null>(null);
  const [countScans, setCountScans] = useState(() => readPref(SCAN_PREF) === '1');
  const [flash, setFlash] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const [adding, setAdding] = useState<{ variantId: string | null; qty: string } | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement | null>());
  const scanRef = useRef<HTMLInputElement>(null);
  const basis = useRef(new Map<string, string>());

  const rows = useMemo(() => visibleRows(sheet, show, runId, buildIds), [buildIds, runId, sheet, show]);
  const shownIds = useMemo(() => new Set(rows.map((row) => row.buildId)), [rows]);
  const priceOf = useCallback((variantId: string) => {
    const variant = variants.find((entry) => entry.id === variantId);
    return variant?.currentRate && variant.currentRate.source !== 'none' ? variant.currentRate.unitPrice : null;
  }, [variants]);
  const totals = totalsFor(rows, drafts, added, moneyHidden, priceOf);
  const dirty = totals.changed > 0 || [...drafts.entries()].some(([id, draft]) => {
    const row = sheet.rows.find((entry) => entry.buildId === id);
    return row ? isDirty(row, draft) : false;
  });
  const changeCount = Math.max(totals.changed, dirty ? 1 : 0);
  useEffect(() => onDirtyChange(changeCount), [changeCount, onDirtyChange]);

  const draftOf = (row: OutputSheetRow) => drafts.get(row.buildId) ?? emptyDraft(row);
  const setDraft = (row: OutputSheetRow, patch: Partial<RowDraft>) => {
    if (!basis.current.has(row.buildId)) basis.current.set(row.buildId, row.builtToday);
    setDrafts((current) => new Map(current).set(row.buildId, { ...(current.get(row.buildId) ?? emptyDraft(row)), ...patch }));
    setFillUndo(null);
  };
  const focusRow = (index: number) => {
    const target = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (target) inputs.current.get(target.buildId)?.focus();
  };

  // "/" focuses the scan bar, Mod Enter saves.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === '/' && !(event.target as HTMLElement)?.closest('input,textarea')) {
        event.preventDefault();
        scanRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Autofocus the first row once.
  useEffect(() => {
    if (pane === 'log' && rows[0] && canLog && !sheet.locked) window.setTimeout(() => inputs.current.get(rows[0]!.buildId)?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane, show]);

  const candidates = closeDayCandidates(sheet, rows, drafts, autoDone);
  const decisionFor = (row: OutputSheetRow): Decision => decisions.get(row.buildId) ?? { action: row.runId.startsWith('run:manual:') ? 'leave_open' : 'move_rest', reason: '', toDate: sheet.nextWorkDay };
  const recentReasons = (readPref(REASONS_PREF) ?? '').split('\n').filter(Boolean).slice(0, 5);

  const save = async (withClose: boolean): Promise<boolean> => {
    const entries = entriesFor(rows, drafts, added, autoDone);
    const endOfDay = withClose
      ? {
          decisions: candidates.map((row) => {
            const decision = decisionFor(row);
            return { buildId: row.buildId, action: decision.action, ...(decision.action === 'close_short' ? { reason: decision.reason.trim() } : {}), ...(decision.action === 'move_rest' ? { toDate: decision.toDate } : {}) };
          }),
        }
      : undefined;
    if (endOfDay?.decisions.some((decision) => decision.action === 'close_short' && !decision.reason)) {
      toast.error('Say why each build closed short', 'Pick a recent reason or type one.');
      return false;
    }
    if (entries.length === 0 && !endOfDay?.decisions.length) {
      onClose();
      return true;
    }
    setSaving(true);
    const result = (await logOutputAction({ key: programKey, date, entries, ...(endOfDay ? { endOfDay } : {}) })) as Result<{ sheet: OutputSheetDTO; undo: Undo; createdBuildIds: string[] }>;
    setSaving(false);
    for (const key of programInvalidations(programKey, date)) void queryClient.invalidateQueries({ queryKey: key });
    if (!result.ok) {
      if (result.error.code === 'CONFLICT') {
        const fresh = (await refetch()) as { data?: OutputSheetDTO };
        const next = new Map<string, string>();
        for (const row of fresh.data?.rows ?? []) {
          const before = basis.current.get(row.buildId);
          const draft = drafts.get(row.buildId);
          if (before !== undefined && draft?.mode === 'set' && quantityToScaled(before) !== quantityToScaled(row.builtToday)) {
            const more = quantityToScaled(row.builtToday) - quantityToScaled(before);
            next.set(row.buildId, `Someone logged ${formatQty(fromScaled(more < BigInt(0) ? -more : more, 3))} ${more < BigInt(0) ? 'less' : 'more'} while you were typing. Now ${formatQty(row.builtToday)}.`);
            basis.current.set(row.buildId, row.builtToday);
          }
        }
        setConflicts(next);
        if (pane === 'close') setPane('log');
        toast.error("Couldn't save the output", next.size ? 'Check the rows marked in red, then save again.' : result.error.message);
      } else toast.error("Couldn't save the output", result.error.message);
      return false;
    }
    if (withClose) {
      const reasons = [...new Set([...candidates.map((row) => decisionFor(row)).filter((d) => d.action === 'close_short').map((d) => d.reason.trim()), ...recentReasons])].slice(0, 5);
      writePref(REASONS_PREF, reasons.join('\n'));
    }
    const units = entries.reduce((sum, entry) => sum + quantityToScaled(entry.qty), BigInt(0));
    const buildsLogged = entries.length;
    const shortCount = endOfDay?.decisions.filter((d) => d.action === 'close_short').length ?? 0;
    const movedCount = endOfDay?.decisions.filter((d) => d.action === 'move_rest').length ?? 0;
    const extra = [shortCount ? `closed ${shortCount} short` : null, movedCount ? `moved ${movedCount}` : null].filter(Boolean).join(', ');
    const message = buildsLogged ? `Logged ${unitLabel(fromScaled(units, 3), unit)} on ${buildsLogged} ${buildsLogged === 1 ? 'build' : 'builds'}${extra ? `, ${extra}` : ''}` : `Closed the day${extra ? `: ${extra}` : ''}`;
    setLive(`Saved ${buildsLogged} rows`);
    const undo = result.data.undo;
    toast.undo(message, {
      onUndo: async () => {
        const back = (await undoLogOutputAction({ key: programKey, undo })) as Result<unknown>;
        for (const key of programInvalidations(programKey, date)) void queryClient.invalidateQueries({ queryKey: key });
        if (!back.ok) toast.error("Couldn't undo", back.error.message);
        else toast.success('Output put back the way it was');
      },
    });
    setDrafts(new Map());
    setAdded([]);
    onDirtyChange(0);
    onClose();
    return true;
  };
  useEffect(() => {
    saveRef.current = () => save(false);
  });

  const onScan = (text: string) => {
    const hit = matchScan(text, sheet, shownIds, variants);
    setScan('');
    if (hit.kind === 'row' && hit.buildId) {
      setScanMiss(null);
      const row = sheet.rows.find((entry) => entry.buildId === hit.buildId);
      if (row && !shownIds.has(row.buildId)) setShow('open');
      if (row) {
        if (countScans) {
          const current = draftOf(row);
          setDraft(row, { mode: 'add', built: addScan(current.mode === 'add' ? current.built : '', hit.packQty) });
          scanRef.current?.focus();
        } else window.setTimeout(() => inputs.current.get(row.buildId)?.focus(), 0);
        setFlash(row.buildId);
        window.setTimeout(() => setFlash(null), 900);
      }
      return;
    }
    setScanMiss({ text, variantId: hit.kind === 'variant' ? hit.variantId ?? null : null });
  };

  const fillAll = () => {
    setFillUndo(new Map(drafts));
    setDrafts((current) => {
      const next = new Map(current);
      for (const row of rows) {
        if (row.statusCategory === 'cancelled') continue;
        const rest = remainingText(row.plannedQty, row.builtBefore);
        next.set(row.buildId, { ...(current.get(row.buildId) ?? emptyDraft(row)), built: rest, mode: 'set' });
      }
      return next;
    });
  };

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void save(false);
    }
  };

  const showOptions = [
    ...(runId && runRows.length ? [{ value: 'run' as const, label: 'This run' }] : []),
    { value: 'today' as const, label: date === today ? "Today's builds" : "This day's builds" },
    { value: 'open' as const, label: 'All open builds' },
  ];
  const locked = sheet.locked;
  const readOnly = !canLog || locked;

  /* ------------------------------------------------------------------------------------------- */

  if (pane === 'close') {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void save(true);
          }
        }}
      >
        <Header title="Close the day" onClose={onClose}>
          <ProgramChip program={program} link={false} size="sm" />
          <span className="text-sm text-fg-secondary">{dayLabel(date)}</span>
        </Header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-sm:px-4">
          {candidates.length === 0 ? (
            <EmptyState illustration="favorites" size="sm" title="Every build of this day is done" description="Nothing is left below plan. Close the day to save." />
          ) : (
            <>
              <p className="mb-3 text-sm text-fg-secondary">
                {candidates.length} {candidates.length === 1 ? 'build is' : 'builds are'} still below plan. Choose what happens to each one.
              </p>
              <ul className="flex flex-col gap-2" data-testid="close-day-list">
                {candidates.map((row) => {
                  const decision = decisionFor(row);
                  const set = (patch: Partial<Decision>) => setDecisions((current) => new Map(current).set(row.buildId, { ...decision, ...patch }));
                  const rest = remainingAfter(row, drafts.get(row.buildId));
                  return (
                    <li key={row.buildId} className="rounded-lg border border-border-subtle bg-panel p-3" data-testid="close-day-row">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-key text-xs text-fg-muted">{row.key}</span>
                        {row.variant ? <VariantChip name={row.variant.name} color={row.variant.color} size="md" /> : <span className="text-sm text-fg">{row.title}</span>}
                        <span className="ml-auto text-xs text-fg-secondary tabular-nums">
                          {qtyOfText(fromScaled(quantityToScaled(row.plannedQty) - quantityToScaled(rest), 3), row.plannedQty, unit)} · {unitLabel(rest, unit)} left
                        </span>
                      </div>
                      <ToggleGroup
                        size="sm"
                        label={`What happens to ${row.key}`}
                        value={decision.action}
                        onValueChange={(action) => set({ action })}
                        className="mt-2.5 w-full max-sm:flex-wrap [&>button]:flex-1"
                        options={[
                          { value: 'move_rest', label: `Move the rest to ${shortDate(decision.toDate)}` },
                          { value: 'close_short', label: 'Close short' },
                          { value: 'leave_open', label: 'Leave open' },
                        ]}
                      />
                      {decision.action === 'close_short' ? (
                        <div className="mt-2.5 flex flex-col gap-1.5">
                          <Input size="sm" aria-label={`Why ${row.key} closed short`} placeholder="Why it closed short" value={decision.reason} onChange={(event) => set({ reason: event.target.value })} invalid={!decision.reason.trim()} data-testid="close-short-reason" />
                          {recentReasons.length ? (
                            <div className="flex flex-wrap gap-1">
                              {recentReasons.map((reason) => (
                                <button key={reason} type="button" onClick={() => set({ reason })} className="rounded-full border border-border-subtle px-2 py-0.5 text-2xs text-fg-secondary hover:bg-hover">
                                  {reason}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {decision.action === 'move_rest' ? (
                        <div className="mt-2.5 flex items-center gap-2 text-xs text-fg-secondary">
                          <span>Makes a linked build for {unitLabel(rest, unit)} on</span>
                          <span className="w-44">
                            <IsoDatePicker value={decision.toDate} onChange={(value) => value && value > date && set({ toDate: value })} size="md" clearable={false} />
                          </span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 py-3 max-sm:px-4">
          <Button variant="ghost" leadingIcon={<ArrowLeft aria-hidden />} onClick={() => setPane('log')}>
            Back
          </Button>
          <span className="flex-1" />
          <Button onClick={() => void save(true)} loading={saving} disabled={readOnly} data-testid="close-day-save">
            Close the day
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onGridKey}>
      <span role="status" aria-live="polite" className="sr-only">
        {live}
      </span>
      <Header title="Log output" onClose={onClose}>
        <ProgramChip program={program} link={false} size="sm" />
        <span className="flex items-center gap-0.5">
          <IconButton size="sm" label="Day before" icon={<ChevronLeft aria-hidden />} onClick={() => onDateChange(addDays(date, -1))} />
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus" data-testid="log-date">
                <CalendarDays aria-hidden className="size-4 text-icon" />
                {dayLabel(date)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              <IsoDatePicker value={date} onChange={(value) => value && value <= today && onDateChange(value)} />
              <p className="mt-2 px-1 text-2xs text-fg-muted">Output can be logged for today or earlier.</p>
            </PopoverContent>
          </Popover>
          <Tooltip content={date >= today ? 'Output can be logged for today or earlier' : 'Day after'}>
            <span>
              <IconButton size="sm" label="Day after" icon={<ChevronRight aria-hidden />} disabled={date >= today} onClick={() => onDateChange(addDays(date, 1))} />
            </span>
          </Tooltip>
        </span>
        {date !== today ? (
          <Button size="xs" variant="ghost" onClick={() => onDateChange(today)}>
            Today
          </Button>
        ) : null}
        {buildIds?.length ? (
          <Badge tone="info" size="sm">
            {buildIds.length} {buildIds.length === 1 ? 'build' : 'builds'} picked
          </Badge>
        ) : (
          <ToggleGroup<ShowMode> size="sm" label="Show" value={show} onValueChange={setShow} options={showOptions} className="max-md:order-last max-md:w-full" />
        )}
      </Header>

      {locked ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-sunken px-5 py-2 text-sm text-fg-secondary">
          <Lock aria-hidden className="size-4 text-icon" />
          {sheet.lockReason ?? 'This day is closed.'} Owners can reopen the month.
        </div>
      ) : !canLog ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-sunken px-5 py-2 text-sm text-fg-secondary">You can view output. Editors can log it.</div>
      ) : null}

      {!readOnly ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-5 py-2.5 max-sm:px-4">
          <div className="relative min-w-[220px] flex-1">
            <ScanLine aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-icon" />
            <input
              ref={scanRef}
              value={scan}
              onChange={(event) => setScan(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && scan.trim()) {
                  event.preventDefault();
                  onScan(scan.trim());
                }
              }}
              aria-label="Scan or type a SKU"
              placeholder="Scan or type a SKU"
              className="h-9 w-full rounded-md border border-border-input bg-panel pr-10 pl-8 text-sm text-fg outline-none placeholder:text-fg-placeholder focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]"
              data-testid="log-scan"
            />
            <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
          </div>
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <Switch
              checked={countScans}
              onCheckedChange={(value) => {
                setCountScans(value);
                writePref(SCAN_PREF, value ? '1' : '0');
              }}
              aria-label="Count each scan"
            />
            Count each scan
          </label>
          {scanMiss ? (
            <p className="flex w-full items-center gap-2 text-xs text-fg-secondary" role="alert" data-testid="scan-miss">
              <AlertTriangle aria-hidden className="size-3.5 text-warning" />
              No build {date === today ? 'today' : 'this day'} for {scanMiss.text}.
              <button
                type="button"
                className="font-semibold text-fg-link hover:underline"
                onClick={() => {
                  setAdding({ variantId: scanMiss.variantId, qty: '' });
                  setScanMiss(null);
                }}
              >
                Add a row?
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      <div role="grid" aria-label={`Output for ${dayLabel(date)}`} aria-rowcount={rows.length + 1} className="min-h-[240px] flex-1 overflow-y-auto" data-testid="log-grid">
        <div role="row" aria-rowindex={1} className="sticky top-0 z-[1] hidden h-9 items-center gap-3 border-b border-border-subtle bg-raised px-5 text-2xs font-semibold tracking-wide text-fg-muted uppercase sm:flex">
          <span role="columnheader" className="min-w-0 flex-1">
            Build
          </span>
          <span role="columnheader" className="w-16 text-right">
            Planned
          </span>
          <span role="columnheader" className="w-20 text-right">
            Built before
          </span>
          <span role="columnheader" className="w-[212px] text-right">
            Built {date === today ? 'today' : dayLabel(date).split(' ')[0]}
          </span>
          <span role="columnheader" className="w-24">
            Mode
          </span>
          <span role="columnheader" className="w-20 text-right">
            Left after
          </span>
          {showScrap ? (
            <span role="columnheader" className="w-20 text-right">
              Scrap
            </span>
          ) : null}
          <span role="columnheader" className="w-12 text-center">
            Done
          </span>
          <span role="columnheader" className="w-8" />
        </div>
        {rows.length === 0 && added.length === 0 ? (
          <EmptyState
            illustration="board"
            size="sm"
            title={`No builds on ${dayLabel(date)}`}
            description="Add a row for work nobody planned, plan builds for this day, or show every open build."
            actions={
              <>
                {!readOnly ? (
                  <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setAdding({ variantId: null, qty: '' })}>
                    Add a row
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => router.push(`/programs/${encodeURIComponent(programKey)}/builds/runs?plan=day&from=${date}`)}>
                  Plan builds for this day
                </Button>
                {show !== 'open' ? (
                  <Button size="sm" variant="ghost" onClick={() => setShow('open')}>
                    Show all open builds
                  </Button>
                ) : null}
              </>
            }
            className="py-10"
          />
        ) : null}
        {rows.map((row, index) => {
          const draft = draftOf(row);
          const over = overPlanBy(row, drafts.get(row.buildId));
          const conflict = conflicts.get(row.buildId);
          const done = willBeDone(row, drafts.get(row.buildId), autoDone);
          const rowReadOnly = readOnly || row.statusCategory === 'cancelled';
          return (
            <div
              key={row.buildId}
              role="row"
              aria-rowindex={index + 2}
              className={cn(
                'flex items-center gap-3 border-b border-border-subtle px-5 py-2 transition-colors max-sm:flex-wrap max-sm:gap-y-2 max-sm:px-4 max-sm:py-3',
                flash === row.buildId && 'bg-primary-subtle',
                conflict && 'bg-danger-subtle/40',
              )}
              data-testid="log-row"
              data-build-key={row.key}
            >
              <span role="gridcell" className="flex min-w-0 flex-1 items-center gap-2 max-sm:basis-full">
                <StatusIcon category={row.statusCategory} size={16} />
                <span className="w-[68px] shrink-0 font-key text-xs text-fg-muted">{row.key}</span>
                {row.variant ? <VariantChip name={row.variant.name} color={row.variant.color} size="md" /> : <span className="truncate text-sm text-fg">{row.title}</span>}
                {row.unplanned ? <Badge tone="info" size="sm">Unplanned</Badge> : null}
                {isCarried(row, date) ? <Badge tone="neutral" size="sm">From {shortDate(row.buildDate)}</Badge> : null}
                {conflict ? <span className="basis-full text-xs font-medium text-danger-text" role="alert">{conflict}</span> : null}
              </span>
              <span role="gridcell" className="w-16 text-right text-sm text-fg-secondary tabular-nums max-sm:w-auto">
                <span className="text-2xs text-fg-muted sm:hidden">Planned </span>
                {formatQty(row.plannedQty)}
              </span>
              <span role="gridcell" className="w-20 text-right text-sm text-fg-muted tabular-nums max-sm:w-auto">
                <span className="text-2xs sm:hidden">Before </span>
                {formatQty(row.builtBefore)}
              </span>
              <span role="gridcell" className="relative flex w-[212px] items-center justify-end gap-1 max-sm:w-full max-sm:order-last">
                {quantityToScaled(row.builtToday) > BigInt(0) && draft.mode === 'add' ? (
                  <span className="mr-auto pl-1 text-2xs whitespace-nowrap text-fg-muted tabular-nums max-sm:text-xs" data-testid="log-logged">{formatQty(row.builtToday)} logged</span>
                ) : null}
                {!rowReadOnly ? (
                  <button type="button" onClick={() => setDraft(row, { built: remainingText(row.plannedQty, row.builtBefore), mode: 'set' })} className="h-8 rounded-md px-2 text-xs font-medium text-fg-link hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus max-sm:h-11 max-sm:px-4 max-sm:text-sm" data-testid="log-fill">
                    Fill
                  </button>
                ) : null}
                <OutputCell
                  ref={(node) => {
                    inputs.current.set(row.buildId, node);
                  }}
                  value={draft.built}
                  onChange={(value) => setDraft(row, { built: value })}
                  label={`Built ${date === today ? 'today' : `on ${dayLabel(date)}`} for ${row.variant?.name ?? row.title}, ${row.key}`}
                  planned={row.plannedQty}
                  builtBefore={draft.mode === 'add' ? fromScaled(quantityToScaled(row.builtBefore) + quantityToScaled(row.builtToday), 3) : row.builtBefore}
                  onEnter={() => focusRow(index + 1)}
                  onShiftEnter={() => focusRow(index - 1)}
                  lockedReason={locked ? sheet.lockReason ?? 'This day is closed.' : null}
                  disabled={rowReadOnly}
                  size="md"
                  className="w-24 max-sm:h-11 max-sm:flex-1 max-sm:text-lg"
                  data-testid="log-built"
                />
              </span>
              <span role="gridcell" className="w-24 max-sm:w-auto">
                <ToggleGroup<'add' | 'set'>
                  size="sm"
                  label={`Add or set for ${row.key}`}
                  value={draft.mode}
                  onValueChange={(mode) => setDraft(row, { mode })}
                  options={[
                    { value: 'add', label: 'Add' },
                    { value: 'set', label: 'Set' },
                  ]}
                />
              </span>
              <span role="gridcell" className={cn('w-20 text-right text-sm tabular-nums max-sm:w-auto', over > BigInt(0) ? 'font-medium text-warning-text' : 'text-fg-secondary')}>
                {over > BigInt(0) ? `${formatQty(fromScaled(over, 3))} over` : formatQty(remainingAfter(row, drafts.get(row.buildId)))}
              </span>
              {showScrap ? (
                <span role="gridcell" className="w-20 max-sm:w-auto">
                  <OutputCell value={draft.scrap} onChange={(value) => setDraft(row, { scrap: value })} label={`Scrap for ${row.key}`} what="scrap" size="sm" disabled={rowReadOnly} className="w-20" />
                </span>
              ) : null}
              <span role="gridcell" className="flex w-12 justify-center max-sm:w-auto">
                <Tooltip content={autoDone ? 'Marks done when the build is full. Uncheck to keep it open.' : 'Mark done'}>
                  <span className="inline-flex">
                    <Checkbox checked={done} disabled={rowReadOnly} onCheckedChange={(value) => setDraft(row, { done: value === true })} aria-label={`Mark ${row.key} done`} />
                  </span>
                </Tooltip>
              </span>
              <span role="gridcell" className="w-8 max-sm:w-auto">
                <Popover>
                  <PopoverTrigger asChild>
                    <IconButton size="sm" label={draft.note ? `Note: ${draft.note}` : `Add a note to ${row.key}`} icon={<MessageSquareText aria-hidden className={cn(draft.note && 'text-primary-text')} />} disabled={rowReadOnly} />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-3">
                    <Input size="sm" autoFocus aria-label={`Note for ${row.key}`} placeholder="One line about this day" value={draft.note} onChange={(event) => setDraft(row, { note: event.target.value })} maxLength={500} />
                  </PopoverContent>
                </Popover>
              </span>
            </div>
          );
        })}
        {added.map((entry) => (
          <div key={entry.id} role="row" className="flex items-center gap-3 border-b border-border-subtle bg-info-subtle/30 px-5 py-2 max-sm:flex-wrap max-sm:px-4" data-testid="log-new-row">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Plus aria-hidden className="size-4 text-icon" />
              <span className="w-[68px] shrink-0 text-xs text-fg-muted">New</span>
              <VariantChip name={entry.variantName} color={entry.variantColor} size="md" />
              <Badge tone="info" size="sm">
                Unplanned
              </Badge>
            </span>
            <span className="flex w-[212px] justify-end">
              <OutputCell value={entry.qty} onChange={(qty) => setAdded((list) => list.map((item) => (item.id === entry.id ? { ...item, qty } : item)))} label={`Built for new ${entry.variantName} build`} size="md" className="w-24" />
            </span>
            <span className="w-24 text-xs text-fg-muted">Planned = built</span>
            <span className="w-20" />
            {showScrap ? <span className="w-20" /> : null}
            <span className="w-12" />
            <span className="w-8">
              <IconButton size="sm" label="Remove this row" icon={<X aria-hidden />} onClick={() => setAdded((list) => list.filter((item) => item.id !== entry.id))} />
            </span>
          </div>
        ))}
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 max-sm:px-4">
            {adding ? (
              <>
                <span className="w-64 max-sm:w-full">
                  <Combobox
                    aria-label="Variant for the new row"
                    placeholder="Pick a variant"
                    searchPlaceholder="Name, key or SKU"
                    value={adding.variantId}
                    onValueChange={(variantId) => setAdding({ ...adding, variantId })}
                    options={variants.filter((variant) => variant.status === 'active').map((variant) => ({ value: variant.id, label: variant.name, description: variant.sku ?? undefined, keywords: [variant.key, variant.sku ?? ''] }))}
                  />
                </span>
                <span className="w-28">
                  <OutputCell value={adding.qty} onChange={(qty) => setAdding({ ...adding, qty })} label="Built for the new row" size="md" onEnter={() => undefined} />
                </span>
                <Button
                  size="sm"
                  disabled={!adding.variantId || !readQty(adding.qty).ok || !(readQty(adding.qty) as { qty: string | null }).qty}
                  onClick={() => {
                    const variant = variants.find((entry) => entry.id === adding.variantId);
                    if (!variant) return;
                    setAdded((list) => [...list, { id: `${variant.id}:${Date.now()}`, variantId: variant.id, variantName: variant.name, variantColor: variant.color, qty: adding.qty }]);
                    setAdding(null);
                  }}
                  data-testid="log-add-confirm"
                >
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" leadingIcon={<Plus aria-hidden />} onClick={() => setAdding({ variantId: null, qty: '' })} data-testid="log-add-row">
                Add a row
              </Button>
            )}
            <span className="flex-1" />
            {fillUndo ? (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Undo2 aria-hidden />}
                onClick={() => {
                  setDrafts(fillUndo);
                  setFillUndo(null);
                }}
              >
                Undo fill
              </Button>
            ) : rows.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={fillAll} data-testid="log-fill-all">
                Fill all to plan
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setShowScrap((value) => !value)}>
              {showScrap ? 'Hide scrap' : 'Show scrap'}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle px-5 py-3 max-sm:px-4">
        <div className="mr-auto flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-fg tabular-nums" data-testid="log-totals">
            {qtyOfText(totals.built, totals.planned, unit)} {date === today ? 'today' : `on ${shortDate(date)}`}
            {totals.revenueCents !== null ? (
              <>
                {' '}
                · <MoneyText cents={totals.revenueCents} />
              </>
            ) : null}
          </span>
          {totals.overPlan > 0 ? (
            <span className="flex items-center gap-1 text-xs text-warning-text" role="status">
              <AlertTriangle aria-hidden className="size-3.5" />
              {totals.overPlan} {totals.overPlan === 1 ? 'build will be' : 'builds will be'} over plan
            </span>
          ) : (
            <span className="text-xs text-fg-muted">
              <Kbd>{mod}</Kbd> <Kbd>Enter</Kbd> saves · <Kbd>=</Kbd> fills a row
            </span>
          )}
        </div>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {!readOnly ? (
          <>
            <Button variant="secondary" onClick={() => void save(false)} loading={saving} disabled={!dirty} data-testid="log-save">
              Save
            </Button>
            <Button onClick={() => setPane('close')} data-testid="log-save-close">
              Save and close the day
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Text for the toast after a quick save elsewhere ("60 of 100 kits"). */
export function builtText(row: OutputSheetRow, unit: { singular: string; plural: string }): string {
  return qtyOfText(fromScaled(quantityToScaled(row.builtBefore) + quantityToScaled(row.builtToday), 3), row.plannedQty, unit);
}

export { trimQty };
