'use client';
/**
 * Floor today (docs/programs/SPEC.md 5.18): the run sheet for the whole floor. Every running
 * program with builds that day, in the person's recent order, as one panel: its runs with the
 * ring and run line, and an inline Built today cell per build (the same cells as the log
 * dialog, saved per program in one `logOutputAction` when a cell loses focus, or with Save).
 * A capacity strip when the workspace has a daily capacity, "Close the day for all" across
 * programs, and a Programs filter remembered on this device. No money anywhere on this page.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ClipboardPen, Factory, ListFilter } from 'lucide-react';
import { addDays, formatHours, formatQty, fromScaled, quantityToScaled, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, EmptyState, IconButton, Input, Popover, PopoverContent, PopoverTrigger, ProgressBar, Skeleton, ToggleGroup, cn, toast } from '@/components/ui';
import { StatusIcon } from '@/components/pm';
import { apiGet, apiPath } from '@/lib/api-client';
import { programInvalidations, useFloorToday, usePrograms } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import type { IsoDate, OutputSheetDTO, OutputSheetRow, RunDTO } from '@/lib/program-types';
import { logOutputAction } from '@/server/actions/output';
import { ProgramChip, VariantChip } from '../kit/chips';
import { QtyProgress, RunRing } from '../kit/numbers';
import { OutputCell } from '../kit/output-cell';
import { readQty, trimQty } from '../kit/qty-input';
import { RUN_STATE_TEXT, RUN_STATE_TONE, dayLabel, doneOfText, qtyOfText } from '../kit/format';
import { logHref } from '../overlays/overlay-params';
import { closeDayCandidates } from '../log-output/log-model';

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly message: string } };
type FloorProgram = NonNullable<ReturnType<typeof useFloorToday>['data']>['programs'][number];

const HIDDEN_KEY = 'ks-programs:floor-hidden';

function readHidden(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function sumBy(runs: readonly RunDTO[], pick: (run: RunDTO) => string): string {
  return fromScaled(runs.reduce((sum, run) => sum + quantityToScaled(pick(run)), BigInt(0)), 3);
}

function ProgramPanel({ program, date, sheet, today }: { readonly program: FloorProgram; readonly date: IsoDate; readonly sheet: OutputSheetDTO | undefined; readonly today: IsoDate }) {
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const [values, setValues] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(program.runs.map((run) => run.id)));
  const rowsByRun = useMemo(() => {
    const map = new Map<string, OutputSheetRow[]>();
    for (const row of sheet?.rows ?? []) if (row.buildDate === date || row.runId.endsWith(date)) map.set(row.runId, [...(map.get(row.runId) ?? []), row]);
    return map;
  }, [date, sheet]);
  const builds = program.runs.reduce((sum, run) => sum + run.builds, 0);
  const done = program.runs.reduce((sum, run) => sum + run.done, 0);
  const canLog = date <= today && !sheet?.locked;
  const pending = [...values.entries()].filter(([buildId, text]) => {
    const row = sheet?.rows.find((entry) => entry.buildId === buildId);
    const read = readQty(text);
    return row && read.ok && quantityToScaled(read.qty ?? '0') !== quantityToScaled(row.builtToday);
  });
  const save = async () => {
    if (!sheet || pending.length === 0) return;
    setSaving(true);
    const entries = pending.map(([buildId, text]) => {
      const row = sheet.rows.find((entry) => entry.buildId === buildId)!;
      return { buildId, mode: 'set' as const, qty: (readQty(text) as { qty: string | null }).qty ?? '0.000', expectedVersion: row.outputVersion };
    });
    const result = (await logOutputAction({ key: program.key, date, entries })) as Result<unknown>;
    setSaving(false);
    for (const key of programInvalidations(program.key, date)) void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: qk.programOutput(program.key, date, null) });
    if (!result.ok) {
      toast.error(`Couldn't save ${program.name}`, result.error.message);
      return;
    }
    setValues(new Map());
    const units = entries.reduce((sum, entry) => sum + quantityToScaled(entry.qty), BigInt(0));
    toast.success(`Saved ${program.name}`, `${unitLabel(fromScaled(units, 3), program.unit)} on ${entries.length} ${entries.length === 1 ? 'build' : 'builds'}`);
  };
  const path = typeof window === 'undefined' ? '/programs/today' : window.location.pathname;
  const current = new URLSearchParams(params?.toString() ?? '');

  return (
    <section className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs" aria-label={program.name} data-testid="floor-program">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-3" data-testid="floor-program-header">
        <ProgramChip program={{ key: program.key, name: program.name }} link={false} size="md" />
        <span className="text-sm text-fg-secondary tabular-nums">
          {qtyOfText(sumBy(program.runs, (run) => run.builtUnits), sumBy(program.runs, (run) => run.plannedUnits), program.unit)} · {doneOfText(done, builds, 'done')}
          {program.estHours ? ` · ${formatHours(program.estHours)} planned` : ''}
        </span>
        <span className="flex-1" />
        {pending.length ? (
          <Button size="sm" onClick={() => void save()} loading={saving} data-testid="floor-save">
            Save {pending.length} {pending.length === 1 ? 'change' : 'changes'}
          </Button>
        ) : null}
        {canLog ? (
          <>
            <Link href={logHref(path, current, { date, programKey: program.key })} scroll={false} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-2.5 text-sm font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
              <ClipboardPen aria-hidden className="size-4" />
              Log output
            </Link>
            <Link href={logHref(path, current, { date, programKey: program.key, step: 'close' })} scroll={false} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
              <CheckCheck aria-hidden className="size-4" />
              Close the day
            </Link>
          </>
        ) : null}
      </header>
      {program.runs.map((run) => {
        const rows = rowsByRun.get(run.id) ?? [];
        const isOpen = open.has(run.id);
        return (
          <div key={run.id} className="border-b border-border-subtle last:border-b-0">
            <button
              type="button"
              onClick={() => setOpen((set) => {
                const next = new Set(set);
                if (next.has(run.id)) next.delete(run.id);
                else next.add(run.id);
                return next;
              })}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover/50 focus-visible:outline-2 focus-visible:outline-focus"
            >
              {isOpen ? <ChevronDown aria-hidden className="size-4 text-icon" /> : <ChevronRight aria-hidden className="size-4 text-icon" />}
              <RunRing done={run.done} total={run.builds} size={24} label={`${run.done} of ${run.builds} builds done in ${run.name}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg">{run.name}</span>
                <span className="block text-xs text-fg-secondary tabular-nums">
                  {qtyOfText(run.builtUnits, run.plannedUnits, program.unit)} · {doneOfText(run.done, run.builds, 'done')}
                </span>
              </span>
              <Badge tone={RUN_STATE_TONE[run.state]} size="sm">
                {RUN_STATE_TEXT[run.state]}
              </Badge>
            </button>
            {isOpen ? (
              <div role="grid" aria-label={`Builds in ${run.name}`}>
                {sheet ? null : <Skeleton height={40} className="mx-4 mb-2" rounded="md" />}
                {rows.map((row) => {
                  const typed = values.get(row.buildId);
                  const shown = typed ?? (quantityToScaled(row.builtToday) > BigInt(0) ? trimQty(row.builtToday) : '');
                  const built = fromScaled(quantityToScaled(row.builtBefore) + quantityToScaled(readQty(shown).ok ? (readQty(shown) as { qty: string | null }).qty ?? '0' : '0'), 3);
                  return (
                    <div key={row.buildId} role="row" className="flex min-h-11 items-center gap-3 border-t border-border-subtle py-1.5 pr-4 pl-11 max-sm:flex-wrap max-sm:pl-4" data-testid="floor-row">
                      <StatusIcon category={row.statusCategory} size={16} />
                      <span className="w-[68px] shrink-0 font-key text-xs text-fg-muted">{row.key}</span>
                      <span className="min-w-0 flex-1">{row.variant ? <VariantChip name={row.variant.name} color={row.variant.color} size="md" /> : <span className="truncate text-sm">{row.title}</span>}</span>
                      <span aria-hidden className="hidden h-0 basis-full max-sm:block" />
                      <span className="w-44 shrink-0 max-sm:w-auto max-sm:flex-1 max-sm:pl-7">
                        <QtyProgress built={built} planned={row.plannedQty} unit={program.unit} />
                      </span>
                      <span className="w-24 shrink-0">
                        {canLog && row.statusCategory !== 'cancelled' ? (
                          <OutputCell
                            value={shown}
                            onChange={(value) => setValues((map) => new Map(map).set(row.buildId, value))}
                            onCommit={() => void save()}
                            label={`Built ${date === today ? 'today' : `on ${dayLabel(date)}`} for ${row.variant?.name ?? row.title}, ${row.key}`}
                            planned={row.plannedQty}
                            builtBefore={row.builtBefore}
                            size="sm"
                            className="w-24"
                            data-testid="floor-cell"
                          />
                        ) : (
                          <span className="block text-right text-sm text-fg-muted tabular-nums">{formatQty(row.builtToday)}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function CloseAllDialog({ programs, sheets, date, onClose }: { readonly programs: readonly FloorProgram[]; readonly sheets: ReadonlyMap<string, OutputSheetDTO>; readonly date: IsoDate; readonly onClose: () => void }) {
  const queryClient = useQueryClient();
  const groups = programs
    .map((program) => {
      const sheet = sheets.get(program.key);
      const rows = sheet ? closeDayCandidates(sheet, sheet.rows.filter((row) => row.buildDate === date), new Map(), false) : [];
      return { program, sheet, rows };
    })
    .filter((group) => group.rows.length > 0 && group.sheet && !group.sheet.locked);
  type Decision = { action: 'close_short' | 'move_rest' | 'leave_open'; reason: string };
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [busy, setBusy] = useState(false);
  const decisionOf = (row: OutputSheetRow): Decision => decisions.get(row.buildId) ?? { action: row.runId.startsWith('run:manual:') ? 'leave_open' : 'move_rest', reason: '' };
  const missingReason = groups.some((group) => group.rows.some((row) => decisionOf(row).action === 'close_short' && !decisionOf(row).reason.trim()));
  const save = async () => {
    setBusy(true);
    let closed = 0;
    for (const group of groups) {
      const result = (await logOutputAction({
        key: group.program.key,
        date,
        entries: [],
        endOfDay: { decisions: group.rows.map((row) => ({ buildId: row.buildId, action: decisionOf(row).action, ...(decisionOf(row).action === 'close_short' ? { reason: decisionOf(row).reason.trim() } : {}), ...(decisionOf(row).action === 'move_rest' ? { toDate: group.sheet!.nextWorkDay } : {}) })) },
      })) as Result<unknown>;
      for (const key of programInvalidations(group.program.key, date)) void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: qk.programOutput(group.program.key, date, null) });
      if (!result.ok) {
        toast.error(`Couldn't close the day for ${group.program.name}`, result.error.message);
        setBusy(false);
        return;
      }
      closed += 1;
    }
    setBusy(false);
    toast.success(`Closed the day for ${closed} ${closed === 1 ? 'program' : 'programs'}`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent size="lg" data-testid="floor-close-all">
        <DialogHeader title="Close the day for all" description={`Builds of ${dayLabel(date)} still below plan, by program.`} />
        <DialogBody className="flex flex-col gap-5 pb-4">
          {groups.length === 0 ? <p className="text-sm text-fg-secondary">Every build of this day is done. Nothing to close.</p> : null}
          {groups.map((group) => (
            <section key={group.program.key} className="flex flex-col gap-2">
              <ProgramChip program={{ key: group.program.key, name: group.program.name }} link={false} size="sm" />
              {group.rows.map((row) => {
                const decision = decisionOf(row);
                const set = (patch: Partial<Decision>) => setDecisions((map) => new Map(map).set(row.buildId, { ...decision, ...patch }));
                const left = fromScaled(quantityToScaled(row.plannedQty) - quantityToScaled(row.builtBefore) - quantityToScaled(row.builtToday), 3);
                return (
                  <div key={row.buildId} className="rounded-lg border border-border-subtle p-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-key text-xs text-fg-muted">{row.key}</span>
                      {row.variant ? <VariantChip name={row.variant.name} color={row.variant.color} /> : null}
                      <span className="ml-auto text-xs text-fg-secondary tabular-nums">{unitLabel(left, group.program.unit)} left</span>
                    </div>
                    <ToggleGroup
                      size="sm"
                      label={`What happens to ${row.key}`}
                      value={decision.action}
                      onValueChange={(action) => set({ action })}
                      className="mt-2 w-full [&>button]:flex-1"
                      options={[
                        { value: 'move_rest', label: `Move the rest to ${dayLabel(group.sheet!.nextWorkDay)}` },
                        { value: 'close_short', label: 'Close short' },
                        { value: 'leave_open', label: 'Leave open' },
                      ]}
                    />
                    {decision.action === 'close_short' ? <Input size="sm" className="mt-2" aria-label={`Why ${row.key} closed short`} placeholder="Why it closed short" value={decision.reason} onChange={(event) => set({ reason: event.target.value })} containerClassName="mt-2" /> : null}
                  </div>
                );
              })}
            </section>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={groups.length === 0 || missingReason}>
            Close the day
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FloorToday({ initialDate }: { readonly initialDate: IsoDate | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const dateParam = params?.get('date');
  const [fallbackToday] = useState(() => new Date().toLocaleDateString('en-CA'));
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : initialDate ?? fallbackToday;
  const floor = useFloorToday(date);
  const programsList = usePrograms({}, { staleTime: 60_000 });
  const [hidden, setHidden] = useState<string[]>([]);
  const [closeAll, setCloseAll] = useState(false);
  useEffect(() => {
    // Device preference: read after mount so the server and first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(readHidden());
  }, []);
  const today = floor.data?.date && !dateParam ? floor.data.date : programsList.data?.[0]?.today.date ?? fallbackToday;
  const allPrograms = floor.data?.programs ?? [];
  const shown = allPrograms.filter((program) => !hidden.includes(program.key));
  const sheets = useQueries({
    queries: shown.map((program) => ({
      queryKey: qk.programOutput(program.key, date, null),
      queryFn: () => apiGet<OutputSheetDTO>(apiPath(`programs/${encodeURIComponent(program.key)}/output`, { date })),
      staleTime: 10_000,
    })),
  });
  const sheetByKey = new Map(shown.map((program, index) => [program.key, sheets[index]?.data]).filter((entry): entry is [string, OutputSheetDTO] => Boolean(entry[1])));
  const go = (next: IsoDate | null) => router.replace(next ? `/programs/today?date=${next}` : '/programs/today', { scroll: false });
  const totals = floor.data?.totals;
  const units = (totals?.plannedUnitsByUnit ?? []).map((entry) => {
    const built = sumBy(shown.filter((program) => program.unit.plural === entry.unit).flatMap((program) => program.runs), (run) => run.builtUnits);
    return `${formatQty(built)} of ${formatQty(entry.units)} ${entry.unit}`;
  });
  const capacity = floor.data?.capacityHours ?? null;
  const est = totals?.estHours ?? null;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6" data-testid="floor-today">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary-text max-sm:hidden">
          <Factory aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg">Floor today</h1>
          {floor.data ? (
            <>
              <p className="mt-0.5 text-sm text-fg-secondary tabular-nums" data-testid="floor-subtitle">
                {dayLabel(date)} · {shown.length} {shown.length === 1 ? 'program' : 'programs'} · {doneOfText(totals?.done ?? 0, totals?.builds ?? 0)}
              </p>
              {units.length ? <p className="text-sm text-fg-muted tabular-nums">{units.join(' · ')}</p> : null}
            </>
          ) : (
            <Skeleton width={320} height={14} className="mt-2" rounded="full" />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton label="Day before" icon={<ChevronLeft aria-hidden />} onClick={() => go(addDays(date, -1))} />
          <IconButton label="Day after" icon={<ChevronRight aria-hidden />} onClick={() => go(addDays(date, 1))} />
          {dateParam ? (
            <Button variant="secondary" size="sm" onClick={() => go(null)}>
              Today
            </Button>
          ) : null}
          {allPrograms.length > 1 ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" leadingIcon={<ListFilter aria-hidden />}>
                  {hidden.length ? `${shown.length} of ${allPrograms.length} programs` : 'Programs'}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2">
                <p className="px-1 pb-1 text-xs text-fg-muted">Show on this page</p>
                {allPrograms.map((program) => (
                  <label key={program.key} className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-sm hover:bg-hover">
                    <Checkbox
                      checked={!hidden.includes(program.key)}
                      onCheckedChange={(checked) => {
                        const next = checked ? hidden.filter((key) => key !== program.key) : [...hidden, program.key];
                        setHidden(next);
                        try {
                          window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
                        } catch {
                          // Storage can be off; the choice lasts for this page.
                        }
                      }}
                      aria-label={program.name}
                    />
                    <span className="truncate">{program.name}</span>
                    <span className="ml-auto font-key text-2xs text-fg-muted">{program.key}</span>
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </header>

      {capacity && est ? (
        <div className="mt-5 rounded-xl border border-border-subtle bg-panel px-4 py-3" data-testid="floor-capacity">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-fg">
              Planned work {formatHours(est)} of {formatHours(capacity)}
            </span>
            <span className="text-xs text-fg-muted">From standard minutes per unit</span>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {shown
              .filter((program) => program.estHours)
              .map((program) => (
                <div key={program.key} className="flex items-center gap-3 text-xs">
                  <span className="w-40 truncate text-fg-secondary">{program.name}</span>
                  <ProgressBar value={Math.min(100, (Number(program.estHours) / Number(capacity)) * 100)} size="sm" label={`${program.name}: ${formatHours(program.estHours)}`} className="flex-1" />
                  <span className="w-16 text-right text-fg-secondary tabular-nums">{formatHours(program.estHours)}</span>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-4">
        {floor.isPending ? (
          [0, 1].map((index) => <Skeleton key={index} height={220} rounded="lg" />)
        ) : floor.isError ? (
          <EmptyState illustration="error" title="We couldn't load the floor" description={floor.error?.message} actions={<Button onClick={() => void floor.refetch()}>Try again</Button>} />
        ) : shown.length === 0 ? (
          <EmptyState
            illustration="board"
            title={date === today ? 'No builds today' : `No builds on ${dayLabel(date)}`}
            description="Plan builds in a program, or pick another day."
            actions={
              programsList.data?.[0] ? (
                <Link href={`/programs/${encodeURIComponent(programsList.data[0].key)}/builds/runs?plan=week`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
                  <CalendarRange aria-hidden className="size-4" />
                  Plan builds
                </Link>
              ) : undefined
            }
          />
        ) : (
          shown.map((program) => <ProgramPanel key={program.key} program={program} date={date} today={today} sheet={sheetByKey.get(program.key)} />)
        )}
      </div>

      {shown.length > 0 && date <= today ? (
        <div className="sticky bottom-4 mt-6 flex justify-end">
          <Button leadingIcon={<CheckCheck aria-hidden />} onClick={() => setCloseAll(true)} className={cn('shadow-md')} data-testid="floor-close-all-button">
            Close the day for all
          </Button>
        </div>
      ) : null}
      {closeAll ? <CloseAllDialog programs={shown} sheets={sheetByKey} date={date} onClose={() => setCloseAll(false)} /> : null}
    </div>
  );
}
