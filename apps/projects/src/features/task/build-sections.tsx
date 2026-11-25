'use client';
/**
 * Build sections of the task drawer and the full build page (docs/programs/SPEC.md 5.8). They
 * work on any page (a program, a project board, My Work): the build, its program and variants
 * are read through their own queries, never from the program page context.
 *
 * - BuildProperties: Variant, Day, Run, Planned (and where it came from), Built (with Log
 *   output), Remaining, Scrap, Rate with Price from and Set build rate, Revenue goes to (with
 *   the Not billed warning and Bill this build to another job), Schedule, Split from.
 * - BuildOutputSection: the days with output (qty, scrap, price, revenue), edit and delete per
 *   day, locked days with the reason.
 * - BuildKitSection: what WMS can build and the shortages for the remaining qty.
 * - BuildLinkedSection: the union of links for the build, with Link a record.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Briefcase, CalendarDays, CircleDollarSign, ClipboardPen, ExternalLink, GitBranch, Hash, Link2, Lock, Package, Pencil, Plus, Repeat2, Shapes, Trash2, Undo2 } from 'lucide-react';
import { formatCents, formatQty, formatUnitPrice, mulQuantityPrice, quantityToScaled, unitLabel } from '@kitstak/programs-engine';
import { Avatar, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, Input, IsoDatePicker, Popover, PopoverContent, PopoverTrigger, Skeleton, Textarea, Tooltip, cn, toast } from '@/components/ui';
import { apiGet, apiPath } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { programInvalidations, useBuildLinks, useProgram, useProgramRuns, useVariants } from '@/lib/hooks/use-programs';
import type { BuildDTO, IsoDate, LinkedRecordDTO, OutputSheetDTO, OutputSheetRow } from '@/lib/program-types';
import type { PersonRef } from '@/lib/types';
import type { PlannedFrom } from '@/lib/constants';
import { updateBuildAction } from '@/server/actions/builds';
import { deleteOutputAction, logOutputAction } from '@/server/actions/output';
import { unlinkRecordAction } from '@/server/actions/program-links';
import { LockIcon, PriceFromChip, RevenueGoesToChip, VariantChip, VariantDot } from '@/features/programs/kit/chips';
import { QtyProgress } from '@/features/programs/kit/numbers';
import { dayLabel } from '@/features/programs/kit/format';
import { OutputCell } from '@/features/programs/kit/output-cell';
import { readQty, trimQty } from '@/features/programs/kit/qty-input';
import { logHref } from '@/features/programs/overlays/overlay-params';
import { LinkPulseJobDialog } from '@/features/integrations/link-pulse-job-dialog';
import { RecordLinkDialog } from '@/features/integrations/record-link-dialog';
import { PropertyRow, PROPERTY_TRIGGER, SectionHeading } from './property-row';
import { useTaskContext } from './task-context';

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly message: string } };

const RATE_RE = /^\$?\s*(\d{1,6})(\.\d{1,4})?$/;

export const buildKey = (id: string) => ['build', id] as const;

/**
 * The build facts of the open task (BuildDTO), or null for a task. Shows the copy a builds view
 * already holds at once (the builds list returns the same BuildDTO) while the fresh one loads.
 */
export function useBuildOf(taskId: string, isBuild: boolean, projectKey?: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: buildKey(taskId),
    queryFn: () => apiGet<BuildDTO>(apiPath(`builds/${encodeURIComponent(taskId)}`)),
    enabled: isBuild,
    staleTime: 15_000,
    placeholderData: () => {
      if (!projectKey) return undefined;
      for (const [, list] of queryClient.getQueriesData<readonly { readonly id: string; readonly kind?: string }[]>({ queryKey: [...qk.projectTasks(projectKey), 'builds'] })) {
        const hit = Array.isArray(list) ? list.find((item) => item.id === taskId && item.kind === 'build') : undefined;
        if (hit) return hit as unknown as BuildDTO;
      }
      return undefined;
    },
  });
}

function useRefreshBuild() {
  const queryClient = useQueryClient();
  const { task, refresh } = useTaskContext();
  return () => {
    void queryClient.invalidateQueries({ queryKey: buildKey(task.id) });
    for (const key of programInvalidations(task.projectKey)) void queryClient.invalidateQueries({ queryKey: key });
    refresh();
  };
}

function isBuildTask(task: { readonly kind?: string }): boolean {
  return task.kind === 'build';
}

/* --------------------------------------------------------------------------------------------- */

function RatePopover({ build, onSaved }: { readonly build: BuildDTO; readonly onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(build.build.rateOverride ? trimQty(build.build.rateOverride) : '');
  const [reason, setReason] = useState(build.build.rateOverrideReason ?? '');
  const [busy, setBusy] = useState(false);
  const clearing = value.trim() === '';
  const match = RATE_RE.exec(value.trim());
  const amount = match ? `${match[1]}${match[2] ?? ''}` : null;
  const days = build.build.locked ? 0 : 1;
  const save = async () => {
    setBusy(true);
    const result = (await updateBuildAction({ taskId: build.id, expectedVersion: build.build.version, patch: { rateOverride: clearing ? null : amount, rateOverrideReason: clearing ? null : reason.trim() } })) as Result<BuildDTO>;
    setBusy(false);
    if (!result.ok) {
      toast.error("Couldn't set the build rate", result.error.message);
      return;
    }
    toast.success(clearing ? `${build.key} uses the price card again` : `${build.key} now earns ${formatUnitPrice(amount)} each`);
    setOpen(false);
    onSaved();
  };
  const delta = amount && quantityToScaled(build.build.builtQty) > BigInt(0) && build.build.currentPrice ? mulQuantityPrice(build.build.builtQty, amount) - mulQuantityPrice(build.build.builtQty, build.build.currentPrice.unitPrice) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="h-7 rounded-md px-2 text-xs font-medium text-fg-link hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus" data-testid="set-build-rate">
          Set build rate
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-3 p-3">
        <p className="text-sm font-semibold text-fg">Set build rate</p>
        <Input size="sm" autoFocus inputMode="decimal" aria-label="Rate per unit" leadingIcon={<span className="text-sm text-fg-muted">$</span>} value={value} onChange={(event) => setValue(event.target.value)} invalid={!clearing && !amount} />
        {!clearing ? <Textarea rows={2} aria-label="Reason" placeholder="Why this build has its own rate" value={reason} onChange={(event) => setReason(event.target.value)} /> : null}
        <p className="text-xs text-fg-secondary">
          {clearing
            ? 'Empty uses the price card again.'
            : delta !== null
              ? `Updates prices on ${days} open ${days === 1 ? 'day' : 'days'}: ${delta >= BigInt(0) ? '+' : ''}${formatCents(delta, { cents: true })}`
              : 'Applies to output on open days.'}
        </p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} loading={busy} disabled={(!clearing && (!amount || !reason.trim())) || build.build.locked}>
            {clearing ? 'Use card rate' : 'Set rate'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "from Weekday glove run", "from variant default", "set by hand" (docs/programs/SPEC.md 5.8). */
function plannedFromText(from: PlannedFrom, runName: string | null): string {
  switch (from) {
    case 'schedule':
      return runName ? `from ${runName}` : 'from a schedule';
    case 'variant_default':
      return 'from variant default';
    case 'planner':
      return 'from the planner';
    case 'unplanned':
      return 'logged without a plan';
    case 'split':
      return 'the rest of another build';
    case 'import':
      return 'from an import';
    case 'form':
      return 'from a form';
    default:
      return 'set by hand';
  }
}

export function BuildProperties() {
  const { task, canEdit, openTask } = useTaskContext();
  const isBuild = isBuildTask(task);
  const buildQuery = useBuildOf(task.id, isBuild, task.projectKey);
  const inProgram = task.projectKind === 'program';
  const program = useProgram(task.projectKey, { enabled: isBuild && inProgram, staleTime: 30_000 });
  const variants = useVariants(task.projectKey, false, { enabled: isBuild && inProgram, staleTime: 60_000 });
  const refreshBuild = useRefreshBuild();
  const [jobOpen, setJobOpen] = useState(false);
  const day = buildQuery.data?.build.buildDate ?? '';
  const runs = useProgramRuns(task.projectKey, { from: day, to: day }, { enabled: isBuild && inProgram && Boolean(day), staleTime: 30_000 });
  const kit = useBuildKit(task.id, isBuild && inProgram);
  if (!isBuild) return null;
  const build = buildQuery.data;
  if (!build) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the build">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} height={28} rounded="md" />
        ))}
      </div>
    );
  }
  const b = build.build;
  const unit = program.data?.unit ?? { singular: 'unit', plural: 'units' };
  const moneyHidden = program.data ? program.data.moneyHidden || !program.data.capabilities.seesMoney : b.revenueCents === null;
  const canPlan = canEdit && (program.data?.capabilities.canPlan ?? true);
  const canPrice = program.data?.capabilities.canPrice ?? canEdit;
  const today = program.data?.calendar.today ?? new Date().toISOString().slice(0, 10);
  const patch = async (change: Parameters<typeof updateBuildAction>[0]['patch'], message?: string) => {
    const result = (await updateBuildAction({ taskId: build.id, expectedVersion: b.version, patch: change })) as Result<BuildDTO>;
    if (!result.ok) {
      toast.error(`Couldn't change ${build.key}`, result.error.message);
      refreshBuild();
      return;
    }
    if (message) toast.success(message);
    refreshBuild();
  };
  const logDate = b.buildDate > today ? today : b.buildDate;
  const scheduleName = b.scheduleId ? (runs.data?.find((run) => run.id === b.runId)?.name ?? null) : null;
  const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
  const kitLink = kit.data?.productUrl ? (
    <a href={kit.data.productUrl} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-link hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus" data-testid="build-kit-link">
      Open kit
      <ExternalLink aria-hidden className="size-3" />
    </a>
  ) : kit.data?.reason === 'not_linked' && b.variantId ? (
    <Link href={`/programs/${encodeURIComponent(task.projectKey)}/variants`} className="h-7 rounded-md px-2 text-xs leading-7 font-medium text-fg-link hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus" data-testid="build-kit-link">
      Link a kit
    </Link>
  ) : null;
  const logLink = logHref(pathname, params, { date: logDate, builds: [build.id], programKey: inProgram && !pathname.startsWith(`/programs/${task.projectKey}`) ? task.projectKey : null });

  return (
    <section aria-label="Build" className="flex flex-col gap-0.5 rounded-xl border border-border-subtle bg-panel px-3 py-2" data-testid="build-block">
      {inProgram ? (
        <PropertyRow icon={<Shapes aria-hidden />} label="Variant">
          {canPlan && (variants.data?.length ?? 0) > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={PROPERTY_TRIGGER} data-testid="build-variant">
                  {b.variantName ? <VariantChip name={b.variantName} color={b.variantColor} sku={variants.data?.find((v) => v.id === b.variantId)?.sku} size="md" /> : <span className="text-fg-muted">Pick a variant</span>}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
                {(variants.data ?? [])
                  .filter((variant) => variant.status === 'active')
                  .map((variant) => (
                    <DropdownMenuItem key={variant.id} icon={<VariantDot color={variant.color} />} description={variant.sku ?? undefined} onSelect={() => variant.id !== b.variantId && void patch({ variantId: variant.id }, `${build.key} is now ${variant.name}`)}>
                      {variant.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : b.variantName ? (
            <span className="px-2">
              <VariantChip name={b.variantName} color={b.variantColor} size="md" />
            </span>
          ) : (
            <span className="px-2 text-sm text-fg-muted">No variant</span>
          )}
          {kitLink}
        </PropertyRow>
      ) : null}
      <PropertyRow icon={<CalendarDays aria-hidden />} label="Day">
        {canPlan && !b.locked ? (
          <span className="w-44">
            <IsoDatePicker clearable={false} value={b.buildDate} onChange={(date) => date && date !== b.buildDate && void patch({ buildDate: date }, `${build.key} moved to ${dayLabel(date)}`)} />
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-2 text-sm text-fg">
            {b.locked ? <LockIcon reason="This day is closed. Owners can reopen the month." /> : null}
            {dayLabel(b.buildDate)}
          </span>
        )}
      </PropertyRow>
      {inProgram ? (
        <PropertyRow icon={<Repeat2 aria-hidden />} label="Run">
          <Link href={`/programs/${encodeURIComponent(task.projectKey)}/builds/runs?range=${b.buildDate}`} className="truncate rounded-sm px-2 py-1 text-sm text-fg-link underline decoration-border-strong underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-focus" data-testid="build-run-link">
            {runs.data?.find((run) => run.id === b.runId)?.name ?? (b.scheduleId ? 'Scheduled run' : 'Unscheduled')} · {dayLabel(b.buildDate)}
          </Link>
        </PropertyRow>
      ) : null}
      <PropertyRow icon={<Hash aria-hidden />} label="Planned">
        <PlannedEditor build={build} unit={unit} canEdit={canPlan && !b.locked} onSave={(qty) => void patch({ plannedQty: qty })} />
        <span className="text-xs text-fg-muted">{plannedFromText(b.plannedFrom, runs.data?.find((run) => run.id === b.runId)?.name ?? null)}</span>
      </PropertyRow>
      <PropertyRow icon={<ClipboardPen aria-hidden />} label="Built">
        <span className="flex items-center gap-2 px-2">
          <QtyProgress built={b.builtQty} planned={b.plannedQty} unit={unit} />
        </span>
        {program.data?.capabilities.canLog ?? canEdit ? (
          <Link href={logLink} scroll={false} className="h-7 rounded-md px-2 text-xs leading-7 font-medium text-fg-link hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus" data-testid="build-log-link">
            Log output
          </Link>
        ) : null}
      </PropertyRow>
      <PropertyRow icon={<Hash aria-hidden />} label="Remaining">
        <span className="px-2 text-sm text-fg tabular-nums">{unitLabel(b.remainingQty, unit)}</span>
      </PropertyRow>
      <PropertyRow icon={<Trash2 aria-hidden />} label="Scrap">
        <span className={cn('px-2 text-sm tabular-nums', quantityToScaled(b.scrapQty) > BigInt(0) ? 'text-fg' : 'text-fg-muted')} data-testid="build-scrap">
          {quantityToScaled(b.scrapQty) > BigInt(0) ? unitLabel(b.scrapQty, unit) : 'None'}
        </span>
      </PropertyRow>
      {!moneyHidden ? (
        <PropertyRow icon={<CircleDollarSign aria-hidden />} label="Rate">
          <span className="flex flex-wrap items-center gap-2 px-2">
            <span className="text-sm text-fg tabular-nums">{formatUnitPrice(b.currentPrice?.unitPrice ?? null)}</span>
            <PriceFromChip source={b.currentPrice?.source ?? 'none'} />
          </span>
          {canPrice && !b.locked ? <RatePopover build={build} onSaved={refreshBuild} /> : null}
          {b.rateOverrideReason ? <span className="basis-full px-2 text-xs text-fg-muted">Reason: {b.rateOverrideReason}</span> : null}
        </PropertyRow>
      ) : null}
      <PropertyRow icon={<Briefcase aria-hidden />} label="Revenue goes to">
        <span className="px-2">
          <RevenueGoesToChip posting={b.posting} jobNumber={b.pulseJob?.number} programKey={inProgram ? task.projectKey : null} />
        </span>
        {!moneyHidden && b.revenueCents && b.revenueCents !== '0' ? <span className="text-sm text-fg-secondary tabular-nums">{formatCents(b.revenueCents, { cents: true })} so far</span> : null}
        {b.posting === 'unbilled' ? (
          <p className="mt-1 flex basis-full items-start gap-1.5 rounded-md bg-warning-subtle px-2 py-1.5 text-xs text-warning-text" data-testid="not-billed">
            <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
            This build is not billed anywhere. Move it to a program or bill it to a Pulse job.
          </p>
        ) : null}
        {canEdit && !moneyHidden ? (
          <button type="button" onClick={() => setJobOpen(true)} className="mt-0.5 h-7 w-fit rounded-md px-2 text-left text-xs font-medium text-fg-link hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus" data-testid="bill-to-job">
            {b.pulseJob ? 'Bill this build to another job' : 'Bill this build to a Pulse job'}
          </button>
        ) : null}
      </PropertyRow>
      {b.scheduleId && inProgram ? (
        <PropertyRow icon={<Repeat2 aria-hidden />} label="Schedule">
          <Link href={`/programs/${encodeURIComponent(task.projectKey)}/schedule`} className="rounded-sm px-2 py-1 text-sm text-fg-link underline decoration-border-strong underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-focus" data-testid="build-schedule-link">
            {scheduleName ? `Made by ${scheduleName}` : 'Made by a schedule'}
          </Link>
        </PropertyRow>
      ) : null}
      {b.splitFrom ? (
        <PropertyRow icon={<GitBranch aria-hidden />} label="Split from">
          <button type="button" onClick={() => openTask(b.splitFrom!.key)} className="rounded-sm px-2 py-1 font-key text-xs text-fg-link hover:underline">
            {b.splitFrom.key}
          </button>
        </PropertyRow>
      ) : null}
      {jobOpen ? <LinkPulseJobDialog open={jobOpen} onOpenChange={setJobOpen} target={{ kind: 'build', buildId: build.id, programId: b.programId }} onLinked={refreshBuild} /> : null}
    </section>
  );
}

function PlannedEditor({ build, unit, canEdit, onSave }: { readonly build: BuildDTO; readonly unit: { singular: string; plural: string }; readonly canEdit: boolean; readonly onSave: (qty: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(trimQty(build.build.plannedQty));
  if (!canEdit) return <span className="px-2 text-sm text-fg tabular-nums">{unitLabel(build.build.plannedQty, unit)}</span>;
  if (!editing) {
    return (
      <button type="button" className={PROPERTY_TRIGGER} onClick={() => setEditing(true)} data-testid="build-planned">
        <span className="tabular-nums">{unitLabel(build.build.plannedQty, unit)}</span>
        <Pencil aria-hidden className="size-3 text-icon opacity-60" />
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const read = readQty(value);
    if (read.ok && read.qty && read.qty !== build.build.plannedQty) onSave(read.qty);
  };
  return (
    <Input
      size="sm"
      autoFocus
      inputMode="decimal"
      aria-label={`Planned ${unit.plural}`}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setEditing(false);
      }}
      containerClassName="w-28"
    />
  );
}

/* --------------------------------------------------------------------------------------------- */

interface OutputDay {
  readonly date: IsoDate;
  readonly qty: string;
  readonly scrap: string;
  readonly price: string | null;
  readonly outputId: string | null;
  readonly version: number | null;
  readonly locked: boolean;
  readonly lockReason: string | null;
  /** Who logged it, where it came from and the note (present when the server sends them). */
  readonly who: PersonRef | null | undefined;
  readonly source: string | null | undefined;
  readonly note: string | null | undefined;
}

/** The optional who, source and note of today's output on a sheet row. */
type OutputRowFacts = { readonly enteredBy?: PersonRef | null; readonly source?: string | null; readonly note?: string | null };

const OUTPUT_SOURCE_LABELS: Readonly<Record<string, string>> = { manual: 'Log dialog', scan: 'Scan', import: 'Import', form: 'Form', floor: 'Floor', api: 'API' };

/** Days to read for a build's output: its day through today (at most 14 days). */
function outputDates(buildDate: IsoDate, today: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let day = buildDate;
  while (day <= today && out.length < 14) {
    out.push(day);
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return out;
}

export function BuildOutputSection() {
  const { task, canEdit } = useTaskContext();
  const isBuild = isBuildTask(task);
  const buildQuery = useBuildOf(task.id, isBuild, task.projectKey);
  const program = useProgram(task.projectKey, { enabled: isBuild && task.projectKind === 'program', staleTime: 30_000 });
  const refreshBuild = useRefreshBuild();
  const b = buildQuery.data?.build;
  const today = program.data?.calendar.today ?? new Date().toISOString().slice(0, 10);
  const dates = useMemo(() => (b && quantityToScaled(b.builtQty) > BigInt(0) ? outputDates(b.buildDate, today) : []), [b, today]);
  const sheets = useQueries({
    queries: dates.map((date) => ({
      queryKey: ['program', task.projectKey, 'output', date, null],
      queryFn: () => apiGet<OutputSheetDTO>(apiPath(`programs/${encodeURIComponent(task.projectKey)}/output`, { date })),
      staleTime: 15_000,
      enabled: isBuild,
    })),
  });
  const [editing, setEditing] = useState<IsoDate | null>(null);
  const [value, setValue] = useState('');
  if (!isBuild || !b) return null;
  const unit = program.data?.unit ?? { singular: 'unit', plural: 'units' };
  const moneyHidden = program.data ? program.data.moneyHidden || !program.data.capabilities.seesMoney : b.revenueCents === null;
  const canLog = canEdit && (program.data?.capabilities.canLog ?? true);
  const days: OutputDay[] = sheets.flatMap((sheet, index) => {
    const row = sheet.data?.rows.find((entry) => entry.buildId === task.id);
    if (!row || quantityToScaled(row.builtToday) === BigInt(0)) return [];
    const facts = row as OutputSheetRow & OutputRowFacts;
    return [{ date: dates[index]!, qty: row.builtToday, scrap: row.scrapToday, price: row.unitPrice, outputId: row.outputId, version: row.outputVersion, locked: Boolean(sheet.data?.locked), lockReason: sheet.data?.lockReason ?? null, who: facts.enteredBy, source: facts.source, note: facts.note }];
  });
  // Who, Source and Note show once the output read carries them.
  const hasFacts = days.some((day) => day.who !== undefined || day.source !== undefined || day.note !== undefined);
  const loading = sheets.some((sheet) => sheet.isPending) && dates.length > 0;

  const save = async (day: OutputDay) => {
    const read = readQty(value);
    setEditing(null);
    if (!read.ok || read.qty === null || read.qty === day.qty) return;
    const result = (await logOutputAction({ key: task.projectKey, date: day.date, entries: [{ buildId: task.id, mode: 'set', qty: read.qty, expectedVersion: day.version }] })) as Result<unknown>;
    if (!result.ok) toast.error("Couldn't change the output", result.error.message);
    else toast.success(`${dayLabel(day.date)} is now ${unitLabel(read.qty, unit)}`);
    refreshBuild();
  };
  const remove = async (day: OutputDay) => {
    if (!day.outputId || day.version === null) return;
    const result = (await deleteOutputAction({ outputId: day.outputId, expectedVersion: day.version })) as Result<unknown>;
    if (!result.ok) {
      toast.error("Couldn't remove the output", result.error.message);
      return;
    }
    refreshBuild();
    toast.undo(`Removed ${unitLabel(day.qty, unit)} from ${dayLabel(day.date)}`, {
      onUndo: async () => {
        const back = (await logOutputAction({ key: task.projectKey, date: day.date, entries: [{ buildId: task.id, mode: 'set', qty: day.qty, ...(quantityToScaled(day.scrap) > BigInt(0) ? { scrapQty: day.scrap } : {}), expectedVersion: null }] })) as Result<unknown>;
        if (!back.ok) toast.error("Couldn't put it back", back.error.message);
        refreshBuild();
      },
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="build-output">
      <SectionHeading icon={<ClipboardPen aria-hidden />} count={days.length || undefined} actions={canLog ? <LogOutputLink taskId={task.id} projectKey={task.projectKey} date={b.buildDate > today ? today : b.buildDate} /> : null}>
        Output
      </SectionHeading>
      {loading ? (
        <Skeleton height={64} rounded="md" />
      ) : days.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing logged yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-sunken/60 text-left text-2xs font-semibold tracking-wide text-fg-muted uppercase">
              <tr>
                <th className="px-3 py-1.5">Day</th>
                <th className="px-3 py-1.5 text-right">Qty</th>
                <th className="px-3 py-1.5 text-right">Scrap</th>
                {!moneyHidden ? <th className="px-3 py-1.5 text-right">Price</th> : null}
                {!moneyHidden ? <th className="px-3 py-1.5 text-right">Revenue</th> : null}
                {hasFacts ? <th className="px-3 py-1.5">Who</th> : null}
                {hasFacts ? <th className="px-3 py-1.5">Source</th> : null}
                {hasFacts ? <th className="px-3 py-1.5">Note</th> : null}
                <th className="w-16 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date} className="border-t border-border-subtle">
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {day.locked ? <LockIcon reason={day.lockReason ?? 'This day is closed.'} /> : null}
                      {dayLabel(day.date)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {editing === day.date ? (
                      <OutputCell value={value} onChange={setValue} label={`Output on ${dayLabel(day.date)}`} onEnter={() => void save(day)} onCommit={() => undefined} size="sm" className="ml-auto w-20" />
                    ) : (
                      formatQty(day.qty)
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-fg-secondary tabular-nums">{quantityToScaled(day.scrap) > BigInt(0) ? formatQty(day.scrap) : ''}</td>
                  {!moneyHidden ? <td className="px-3 py-1.5 text-right text-fg-secondary tabular-nums">{formatUnitPrice(day.price)}</td> : null}
                  {!moneyHidden ? <td className="px-3 py-1.5 text-right tabular-nums">{day.price ? formatCents(mulQuantityPrice(day.qty, day.price), { cents: true }) : formatCents(0, { cents: true })}</td> : null}
                  {hasFacts ? (
                    <td className="px-3 py-1.5">
                      {day.who ? (
                        <Tooltip content={day.who.name}>
                          <span className="inline-flex" tabIndex={0}>
                            <Avatar name={day.who.name} src={day.who.image} size="xs" />
                          </span>
                        </Tooltip>
                      ) : null}
                    </td>
                  ) : null}
                  {hasFacts ? <td className="px-3 py-1.5 text-xs whitespace-nowrap text-fg-secondary">{day.source ? (OUTPUT_SOURCE_LABELS[day.source] ?? day.source) : ''}</td> : null}
                  {hasFacts ? (
                    <td className="max-w-40 px-3 py-1.5 text-xs text-fg-secondary">
                      {day.note ? (
                        <Tooltip content={day.note}>
                          <span tabIndex={0} className="block truncate">
                            {day.note}
                          </span>
                        </Tooltip>
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {canLog && !day.locked ? (
                      editing === day.date ? (
                        <Button size="xs" onClick={() => void save(day)}>
                          Save
                        </Button>
                      ) : (
                        <>
                          <IconButton
                            size="sm"
                            label={`Change ${dayLabel(day.date)}`}
                            icon={<Pencil aria-hidden />}
                            onClick={() => {
                              setValue(trimQty(day.qty));
                              setEditing(day.date);
                            }}
                          />
                          <IconButton size="sm" label={`Remove output on ${dayLabel(day.date)}`} icon={<Trash2 aria-hidden />} onClick={() => void remove(day)} />
                        </>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {b.batchFeeLocked && b.finishedOn ? <p className="text-xs text-fg-muted">The batch fee for {dayLabel(b.finishedOn).slice(4)} stays because that month is closed.</p> : null}
    </div>
  );
}

function LogOutputLink({ taskId, projectKey, date }: { readonly taskId: string; readonly projectKey: string; readonly date: IsoDate }) {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
  const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  return (
    <Link href={logHref(pathname, params, { date, builds: [taskId], programKey: pathname.startsWith(`/programs/${projectKey}`) ? null : projectKey })} scroll={false} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-link hover:bg-hover">
      <Plus aria-hidden className="size-3.5" />
      Log output
    </Link>
  );
}

/* --------------------------------------------------------------------------------------------- */

interface KitShortage {
  readonly available: boolean;
  readonly reason?: string;
  readonly canBuild?: string | number | null;
  readonly asOf?: string | null;
  readonly components?: readonly { readonly sku: string; readonly name: string; readonly need: string; readonly free: string; readonly short: string }[];
  readonly productUrl?: string | null;
}

/** The kit of a build's variant in WMS: stock, shortages and the product link. */
function useBuildKit(taskId: string, enabled: boolean) {
  return useQuery({ queryKey: ['build', taskId, 'shortages'], queryFn: () => apiGet<KitShortage>(apiPath(`builds/${encodeURIComponent(taskId)}/shortages`)), enabled, retry: false, staleTime: 60_000 });
}

export function BuildKitSection() {
  const { task } = useTaskContext();
  const isBuild = isBuildTask(task) && task.projectKind === 'program';
  const shortages = useBuildKit(task.id, isBuild);
  if (!isBuild || !shortages.data) return null;
  const data = shortages.data;
  if (!data.available) {
    if (data.reason === 'not_linked') {
      return (
        <div className="flex flex-col gap-1.5" data-testid="build-kit">
          <SectionHeading icon={<Package aria-hidden />}>Kit</SectionHeading>
          <p className="text-sm text-fg-muted">
            <Link href={`/programs/${encodeURIComponent(task.projectKey)}/variants`} className="text-fg-link hover:underline">
              Link this variant to a kit
            </Link>{' '}
            to see stock.
          </p>
        </div>
      );
    }
    return null;
  }
  const short = (data.components ?? []).filter((component) => quantityToScaled(component.short) > BigInt(0));
  return (
    <div className="flex flex-col gap-1.5" data-testid="build-kit">
      <SectionHeading icon={<Package aria-hidden />} actions={data.productUrl ? <a href={data.productUrl} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-link hover:bg-hover">Open in WMS <ExternalLink aria-hidden className="size-3" /></a> : null}>
        Kit
      </SectionHeading>
      {data.canBuild !== undefined && data.canBuild !== null ? <p className="text-sm text-fg">Can build {formatQty(String(data.canBuild))}{data.asOf ? <span className="text-fg-muted"> · as of {new Date(data.asOf).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span> : null}</p> : null}
      {short.length ? (
        <ul className="flex flex-col gap-1">
          {short.map((component) => (
            <li key={component.sku} className="flex items-center gap-1.5 text-sm text-warning-text">
              <AlertTriangle aria-hidden className="size-3.5" />
              Short {formatQty(component.short)} of {component.sku} (need {formatQty(component.need)}, free {formatQty(component.free)})
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-success-text">Enough parts for the remaining qty.</p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------------------------- */

export function BuildLinkedSection() {
  const { task, canEdit } = useTaskContext();
  const isBuild = isBuildTask(task);
  const links = useBuildLinks(task.id, { enabled: isBuild });
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  if (!isBuild) return null;
  const list: readonly LinkedRecordDTO[] = links.data ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['build', task.id, 'links'] });
  const remove = async (link: LinkedRecordDTO) => {
    const result = (await unlinkRecordAction({ linkId: link.linkId })) as Result<unknown>;
    if (!result.ok) toast.error("Couldn't remove the link", result.error.message);
    else toast.success(`Removed the link to ${link.title}`);
    refresh();
  };
  return (
    <div className="flex flex-col gap-2" data-testid="build-linked">
      <SectionHeading
        icon={<Link2 aria-hidden />}
        count={list.length || undefined}
        actions={
          canEdit ? (
            <Button size="xs" variant="ghost" leadingIcon={<Plus aria-hidden />} onClick={() => setOpen(true)}>
              Link a record
            </Button>
          ) : null
        }
      >
        Linked
      </SectionHeading>
      {links.isPending ? (
        <Skeleton height={32} rounded="md" />
      ) : list.length === 0 ? (
        <p className="text-sm text-fg-muted">No linked records. Link a deal, a job, a project or another build.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {list.map((link) => (
            <li key={link.linkId} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Boxes aria-hidden className="size-4 shrink-0 text-icon" />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate', link.dangling ? 'text-fg-muted' : 'text-fg')}>{link.dangling ? 'This record is no longer available' : link.title}</span>
                <span className="block text-2xs text-fg-muted">
                  {link.relation === 'bills_to' ? 'Bills to' : link.relation === 'created_from' ? 'Made from' : 'Related'}
                  {link.status ? ` · ${link.status}` : ''}
                </span>
              </span>
              {link.url && !link.dangling ? (
                <a href={link.url} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-link hover:bg-hover">
                  Open
                </a>
              ) : null}
              {canEdit && link.removable && !link.moneyEdge ? (
                <Tooltip content="Remove link">
                  <IconButton size="sm" label={`Remove the link to ${link.title}`} icon={<Undo2 aria-hidden />} onClick={() => void remove(link)} />
                </Tooltip>
              ) : null}
              {link.moneyEdge ? (
                <Tooltip content="This link decides where revenue goes. Change it from Revenue goes to.">
                  <span tabIndex={0} className="inline-flex text-icon">
                    <Lock aria-hidden className="size-3.5" />
                  </span>
                </Tooltip>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {open ? <RecordLinkDialog open={open} onOpenChange={setOpen} from={{ type: 'pm_build', id: task.id }} existing={list} onLinked={refresh} /> : null}
    </div>
  );
}

