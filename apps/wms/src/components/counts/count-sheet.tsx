'use client';

/**
 * Web Count Sheet (M07 checklist 3). Lists the plan's countable lines (Ready To Count /
 * Count Started) in walking order. Scan a location (code or barcode) to jump to its line,
 * enter the counted qty per SKU / lot / LP, submit: `POST /api/counts/[id]/sheet`
 * executes the line's Count task through `tasks.execute`, so the count task handler
 * records the entries, auto-updates no-difference lines when the job type says so, and
 * rolls the plan up. The next uncounted line opens automatically.
 * Logiwa mobile count actions: Skip location (parks the line at the end of the walk), Reset
 * location count (clears what was entered), and Mark damaged per row (count-entry-table).
 */
import * as React from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ClipboardList,
  Eraser,
  MapPin,
  RotateCcw,
  ScanLine,
  Send,
  SkipForward,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FieldError, FieldLabel } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { CountStatusPill } from './count-status-pill';
import { TextField } from '@/components/ui/text-field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { LocationPicker } from '@/components/shared/entity-pickers';
import {
  CountEntryTable,
  countedValueError,
  draftsError,
  draftsFromBuckets,
  toPayload,
  type EntryDraft,
  type SheetBucket,
} from './count-entry-table';
import { errorMessage, COUNT_QUERY_TIMEOUT_MS } from './counts-client';

export interface SheetLine {
  readonly lineId: string;
  readonly taskId: string | null;
  readonly taskNo: number | null;
  readonly jobCode: string | null;
  readonly status: string;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly locationBarcode: string | null;
  readonly productId: string | null;
  readonly sku: string | null;
  readonly isRecountLine: boolean;
  /** Blind count job: quantities withheld by the server. */
  readonly blind?: boolean;
  readonly buckets: readonly SheetBucket[];
}

export interface CountSheetProps {
  readonly planId: string;
  readonly planCode: string;
  readonly planStatus: string;
  readonly warehouseId: string;
  readonly canExecute: boolean;
  readonly onSubmitted: () => void;
  readonly onCreateJob?: () => void;
}

/** Walking order with skipped lines moved to the end, in the order they were skipped. */
export function orderBySkip<T extends { readonly lineId: string }>(
  lines: readonly T[],
  skipped: readonly string[],
): T[] {
  if (skipped.length === 0) return [...lines];
  const rank = new Map(skipped.map((id, i) => [id, i]));
  const kept = lines.filter((l) => !rank.has(l.lineId));
  const parked = lines
    .filter((l) => rank.has(l.lineId))
    .sort((a, b) => (rank.get(a.lineId) ?? 0) - (rank.get(b.lineId) ?? 0));
  return [...kept, ...parked];
}

const lineTitle = (l: SheetLine): string => [l.locationCode, l.sku].filter(Boolean).join(' · ') || 'Line';

export function CountSheet({
  planId,
  planCode,
  planStatus,
  warehouseId,
  canExecute,
  onSubmitted,
  onCreateJob,
}: CountSheetProps) {
  const sheet = useApiQuery<SheetLine[]>(
    ['count-sheet', planId],
    `/api/counts/${encodeURIComponent(planId)}/sheet`,
    { timeoutMs: COUNT_QUERY_TIMEOUT_MS },
  );
  const rawLines = React.useMemo(() => sheet.data?.data ?? [], [sheet.data]);
  const [pickedId, setActiveId] = React.useState<string | null>(null);
  const [draftsByLine, setDraftsByLine] = React.useState<Readonly<Record<string, readonly EntryDraft[]>>>({});
  const [locationByLine, setLocationByLine] = React.useState<Readonly<Record<string, string | null>>>({});
  const [note, setNote] = React.useState('');
  const [scan, setScan] = React.useState('');
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [doneCount, setDoneCount] = React.useState(0);
  // Logiwa mobile "Skip location": skipped lines move to the end of the walk for this session.
  const [skipped, setSkipped] = React.useState<readonly string[]>([]);
  const scanRef = React.useRef<HTMLInputElement>(null);
  const lines = React.useMemo(() => orderBySkip(rawLines, skipped), [rawLines, skipped]);
  // The picked line, or the first countable one (also after a refetch drops the picked line).
  const active = lines.find((l) => l.lineId === pickedId) ?? lines[0] ?? null;
  const activeId = active?.lineId ?? null;
  const drafts =
    (activeId ? draftsByLine[activeId] : undefined) ?? (active ? draftsFromBuckets(active.buckets) : []);
  const setDrafts = (next: readonly EntryDraft[]) => {
    if (activeId) setDraftsByLine((m) => ({ ...m, [activeId]: next }));
  };
  const locationId = (activeId ? locationByLine[activeId] : undefined) ?? active?.locationId ?? null;
  const setLocationId = (v: string | null) => {
    if (activeId) setLocationByLine((m) => ({ ...m, [activeId]: v }));
  };

  const open = (line: SheetLine | null) => {
    setActiveId(line?.lineId ?? null);
    if (line)
      setDraftsByLine((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== line.lineId)));
    setNote('');
    setTried(false);
  };

  const findByScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim().toLowerCase();
    if (!code) {
      setScanError('Scan or type a location code');
      return;
    }
    const hit = lines.find(
      (l) => l.locationCode?.toLowerCase() === code || l.locationBarcode?.toLowerCase() === code,
    );
    if (!hit) {
      setScanError(`${scan.trim()} is not waiting to be counted in ${planCode}`);
      requestAnimationFrame(() => scanRef.current?.select());
      return;
    }
    setScanError(null);
    setScan('');
    open(hit);
  };

  /** Skip location: park the line at the end of the walk and open the next one. Nothing is saved. */
  const skip = () => {
    if (!active) return;
    const idx = lines.findIndex((l) => l.lineId === active.lineId);
    const next = [...lines.slice(idx + 1), ...lines.slice(0, idx)].find((l) => l.taskId) ?? null;
    if (!next) {
      toast.info('Nothing to skip to', `${lineTitle(active)} is the only line left to count.`);
      return;
    }
    setSkipped((s) => [...s.filter((id) => id !== active.lineId), active.lineId]);
    open(next);
    toast.info(
      'Location skipped',
      `${lineTitle(active)} moved to the end of the list. Count it when you get back to it.`,
    );
    requestAnimationFrame(() => scanRef.current?.focus());
  };
  /** Reset location count: drop everything entered for this line (counts, found and damaged rows, note). */
  const reset = () => {
    if (!active) return;
    setDraftsByLine((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== active.lineId)));
    setNote('');
    setTried(false);
  };
  const touched = Boolean(activeId && draftsByLine[activeId]) || note.trim() !== '';

  const entryError = draftsError(drafts);
  const needsLocation = Boolean(active && !active.locationId && !locationId);
  const invalidValue = drafts.some((d) => countedValueError(d.counted));
  const submitReason = !canExecute
    ? "You don't have permission to enter counts"
    : !active
      ? 'Pick a line to count'
      : !active.taskId
        ? "This line's count job was cancelled. Re-create the job first"
        : invalidValue
          ? 'Fix the invalid counted quantities'
          : saving
            ? 'Submitting…'
            : null;

  const submit = async () => {
    setTried(true);
    if (!active || entryError || needsLocation) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ lineId: string; status: string }>(
        `/api/counts/${encodeURIComponent(planId)}/sheet`,
        {
          method: 'POST',
          body: { lineId: active.lineId, locationId, entries: toPayload(drafts), note: note.trim() || null },
        },
      );
      toast.success(
        'Success',
        `${lineTitle(active)} counted${res.status === 'Inventory Updated' ? ' with no difference; inventory is confirmed' : ''}.`,
      );
      setDoneCount((n) => n + 1);
      const idx = lines.findIndex((l) => l.lineId === active.lineId);
      const next =
        lines.slice(idx + 1).find((l) => l.taskId) ??
        lines.find((l) => l.taskId && l.lineId !== active.lineId) ??
        null;
      open(next);
      onSubmitted();
      await sheet.refetch();
      requestAnimationFrame(() => scanRef.current?.focus());
    } catch (error) {
      toast.error('Error', errorMessage(error, 'The count could not be submitted.'));
    } finally {
      setSaving(false);
    }
  };

  if (sheet.isPending)
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  if (sheet.error)
    return (
      <Callout
        variant="error"
        title="The count sheet could not be loaded"
        action={
          <Button size="sm" variant="secondary" onClick={() => void sheet.refetch()}>
            Retry
          </Button>
        }
      >
        {sheet.error.message}
      </Callout>
    );

  if (lines.length === 0) {
    const pending = planStatus === 'Pending';
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-12 text-center">
        <span
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-xl',
            pending ? 'bg-primary-soft text-primary' : 'bg-success-soft text-success',
          )}
        >
          {pending ? (
            <ClipboardList className="h-5 w-5" aria-hidden />
          ) : (
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          )}
        </span>
        <p className="text-base font-semibold text-foreground">
          {pending ? 'Create a job to start counting' : 'Nothing left to count'}
        </p>
        <p className="max-w-[460px] text-xs text-secondary">
          {pending
            ? 'Count lines become countable once a Count job exists. Create Job splits the plan into jobs by location batch.'
            : doneCount > 0
              ? `You counted ${doneCount} ${doneCount === 1 ? 'line' : 'lines'} in this session. Review differences on the Lines tab, then update inventory or create recounts.`
              : 'Every line of this plan is counted, posted or cancelled. Review the Lines tab for differences.'}
        </p>
        {pending && onCreateJob ? (
          <Button variant="primary" className="mt-2" onClick={onCreateJob}>
            <ClipboardList className="h-3.5 w-3.5" aria-hidden />
            Create Job
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside aria-label="Lines to count" className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-2">
        <form noValidate onSubmit={findByScan} className="order-1 flex flex-col gap-1 lg:order-none">
          <FieldLabel htmlFor="cs-scan">Scan location</FieldLabel>
          <TextField
            id="cs-scan"
            ref={scanRef}
            value={scan}
            maxLength={120}
            placeholder="Scan a location barcode"
            onChange={(e) => {
              setScan(e.target.value);
              setScanError(null);
            }}
            invalid={Boolean(scanError)}
            leading={<ScanLine className="h-4 w-4 text-faint" aria-hidden />}
            aria-describedby={scanError ? 'cs-scan-err' : undefined}
          />
          <FieldError id="cs-scan-err" message={scanError ?? undefined} />
        </form>
        <p className="order-3 text-2xs font-semibold text-faint lg:order-none">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'} to count
        </p>
        <ul className="ks-scroll order-4 -mt-2 flex max-h-[40vh] flex-col gap-1 overflow-auto pr-1 lg:order-none lg:mt-0 lg:max-h-[56vh]">
          {lines.map((l) => {
            const isActive = l.lineId === activeId;
            return (
              <li key={l.lineId}>
                <button
                  type="button"
                  onClick={() => open(l)}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                    isActive
                      ? 'border-primary bg-primary-soft'
                      : 'border-border bg-surface hover:border-border-strong',
                  )}
                >
                  <MapPin
                    className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-faint')}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-semibold text-foreground">{lineTitle(l)}</span>
                    <span
                      className={cn(
                        'truncate text-2xs',
                        l.taskId ? 'text-secondary' : 'font-semibold text-danger',
                      )}
                    >
                      {l.taskId ? l.jobCode : 'Job cancelled'} · {l.buckets.length}{' '}
                      {l.buckets.length === 1 ? 'bucket' : 'buckets'}
                    </span>
                  </span>
                  {skipped.includes(l.lineId) ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-surface-sunken px-1.5 py-px text-2xs font-semibold text-secondary">
                      <SkipForward className="h-2.5 w-2.5" aria-hidden />
                      Skipped
                    </span>
                  ) : null}
                  {l.isRecountLine ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-warning-soft px-1.5 py-px text-2xs font-semibold text-warning">
                      <RotateCcw className="h-2.5 w-2.5" aria-hidden />
                      Recount
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {active ? (
        <section
          aria-label={`Count ${lineTitle(active)}`}
          className="order-2 flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:p-4 lg:order-none"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-md font-semibold text-foreground">{lineTitle(active)}</h3>
              <CountStatusPill status={active.status} domain="count" size="sm" />
              {active.isRecountLine ? (
                <span className="text-xs font-semibold text-warning">Recount line</span>
              ) : null}
            </div>
            <span className="text-xs text-secondary">
              {active.jobCode ? (
                <>
                  Job <strong className="text-foreground">{active.jobCode}</strong>
                  {active.taskNo ? ` · task ${active.taskNo}` : ''}
                </>
              ) : (
                'No live count task'
              )}
            </span>
          </div>
          {!active.taskId ? (
            <Callout
              variant="error"
              title="This line's count job was cancelled"
              action={
                onCreateJob ? (
                  <Button size="sm" variant="primary" onClick={onCreateJob}>
                    <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                    Re-create job
                  </Button>
                ) : undefined
              }
            >
              Re-create the job to issue a new count task for it, then count it here.
            </Callout>
          ) : null}
          {!active.locationId ? (
            <div className="flex flex-col gap-1 sm:max-w-[360px]">
              <FieldLabel htmlFor="cs-loc" required>
                Counted location
              </FieldLabel>
              <LocationPicker
                id="cs-loc"
                warehouseId={warehouseId}
                value={locationId}
                onChange={(v) => setLocationId(v)}
                invalid={tried && needsLocation}
              />
              <FieldError
                id="cs-loc-err"
                message={tried && needsLocation ? 'Scan the location you counted' : undefined}
              />
            </div>
          ) : null}
          <CountEntryTable
            drafts={drafts}
            onChange={setDrafts}
            warehouseId={warehouseId}
            productId={active.productId}
            disabled={saving || !canExecute}
            showErrors={tried}
            idPrefix={`cs-${active.lineId}`}
            blind={Boolean(active.blind)}
          />
          {tried && entryError ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {entryError}
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="cs-note">Note</FieldLabel>
            <Textarea
              id="cs-note"
              rows={2}
              maxLength={400}
              showCount
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Damaged boxes, mislabeled bins…"
              disabled={!canExecute}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-xs text-secondary">
              Blank expected stock is not allowed. Enter 0 when it is missing.
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <DisabledReason
                reason={saving ? 'Submitting…' : !touched ? 'Nothing entered for this location yet' : null}
              >
                <Button variant="ghost" disabled={saving || !touched} onClick={reset}>
                  <Eraser className="h-3.5 w-3.5" aria-hidden />
                  Reset count
                </Button>
              </DisabledReason>
              <DisabledReason
                reason={
                  saving ? 'Submitting…' : lines.length < 2 ? 'This is the only line left to count' : null
                }
              >
                <Button variant="secondary" disabled={saving || lines.length < 2} onClick={skip}>
                  <SkipForward className="h-3.5 w-3.5" aria-hidden />
                  Skip location
                </Button>
              </DisabledReason>
            </span>
            <DisabledReason reason={submitReason}>
              <Button variant="primary" disabled={Boolean(submitReason)} onClick={() => void submit()}>
                {saving ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" aria-hidden />}
                Submit count
              </Button>
            </DisabledReason>
          </div>
        </section>
      ) : (
        <div className="order-2 flex items-center justify-center rounded-lg border border-dashed border-border-strong p-10 text-sm text-secondary lg:order-none">
          Pick a line on the left or scan its location.
        </div>
      )}
      <p className="order-5 text-2xs text-faint lg:order-none lg:col-span-2">
        Counts also arrive from scanners through the job{' '}
        <Link href="/tasks/count" className="font-semibold text-primary hover:underline">
          Count Task Details
        </Link>
        .
      </p>
    </div>
  );
}
