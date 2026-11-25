'use client';
/**
 * Runs view, the default Builds view (docs/programs/SPEC.md 5.7): one expandable row per run,
 * newest day first inside the range, today open. A run row shows the ring, "Wed Nov 25 · Weekday
 * glove run · 560 of 800 kits · 5 of 8 done", its state, revenue and the run menu. Open runs list
 * their builds with an inline Built today cell (the day total, saved on Enter or when the cell
 * loses focus) like Monday items with subitems.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardPen } from 'lucide-react';
import { formatQty, quantityToScaled, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, Skeleton, Tooltip, cn } from '@/components/ui';
import { PersonAvatar, StatusIcon } from '@/components/pm';
import { useOutputSheet, useProgramRuns } from '@/lib/hooks/use-programs';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import type { IsoDate, OutputSheetRow, RunDTO } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import { useCardExtras } from '@/features/views/card-extras';
import { useCurrentProgram } from '../program-context';
import { RUN_STATE_TEXT, RUN_STATE_TONE, dayLabel, doneOfText, qtyOfText } from '../kit/format';
import { LockIcon, VariantChip } from '../kit/chips';
import { MoneyText, QtyProgress, RunRing } from '../kit/numbers';
import { OutputCell } from '../kit/output-cell';
import { readQty, trimQty } from '../kit/qty-input';
import { useProgramOverlays } from '../overlays/overlay-params';
import { buildOf } from './builds-model';
import { useLogEntries } from './built-editor';
import { RunMenu } from './run-menu';

const OPEN_KEY = (key: string) => `ks-programs:runs-open:${key}`;

function readOpen(key: string): Set<string> | null {
  try {
    const raw = window.sessionStorage.getItem(OPEN_KEY(key));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function BuildRow({ task, sheetRow, date, onSaved }: { readonly task: TaskSummary; readonly sheetRow: OutputSheetRow | undefined; readonly date: IsoDate; readonly onSaved: () => void }) {
  const { key, unit, today, capabilities, statusById, moneyHidden } = useCurrentProgram();
  const { openTask } = useTaskDrawer();
  const log = useLogEntries(key);
  const build = buildOf(task)!;
  const saved = sheetRow ? trimQty(sheetRow.builtToday) : '';
  const [value, setValue] = useState(saved === '0' ? '' : saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    // Keep the cell in step with the server after a save or someone else's change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(saved === '0' ? '' : saved);
  }, [saved]);
  const status = statusById.get(task.statusId);
  const canLog = capabilities.canLog && date <= today && task.statusCategory !== 'cancelled';
  const commit = async (text: string) => {
    const read = readQty(text);
    if (!read.ok) return;
    const next = read.qty ?? '0.000';
    const before = sheetRow?.builtToday ?? '0.000';
    if (quantityToScaled(next) === quantityToScaled(before)) return;
    setSaving(true);
    const ok = await log(date, [{ buildId: task.id, mode: 'set', qty: next }], `${task.key}: ${unitLabel(next, unit)} on ${dayLabel(date)}`);
    setSaving(false);
    if (ok) onSaved();
  };
  return (
    <div
      role="row"
      className="group/row flex min-h-11 items-center gap-3 border-t border-border-subtle pr-3 pl-12 text-sm hover:bg-hover/60 max-sm:flex-wrap max-sm:gap-y-1 max-sm:py-2 max-sm:pl-4"
      data-testid="run-build-row"
      data-task-key={task.key}
    >
      <button type="button" onClick={() => openTask(task.key)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-focus max-sm:basis-full" aria-label={`Open ${task.key}`}>
        <StatusIcon category={task.statusCategory} color={status?.color} size={16} />
        <span className="w-20 shrink-0 font-key text-xs text-fg-muted">{task.key}</span>
        {build.variantName ? <VariantChip name={build.variantName} color={build.variantColor} size="md" /> : <span className="truncate text-fg">{task.title}</span>}
        {build.unplanned ? <Badge tone="info" size="sm">Unplanned</Badge> : null}
        {build.closedShort ? <Badge tone="warning" size="sm">Closed short</Badge> : null}
      </button>
      <PersonAvatar userId={task.assigneeId} size="xs" />
      <span className="w-44 shrink-0 max-md:w-auto">
        <QtyProgress built={build.builtQty} planned={build.plannedQty} unit={unit} />
      </span>
      {!moneyHidden ? <span className="w-24 shrink-0 text-right text-sm text-fg-secondary max-lg:hidden">{build.revenueCents && build.revenueCents !== '0' ? <MoneyText cents={build.revenueCents} /> : null}</span> : null}
      <span className="flex w-28 shrink-0 items-center justify-end gap-1.5">
        {canLog ? (
          <OutputCell
            value={value}
            onChange={setValue}
            onCommit={(text) => void commit(text)}
            label={`Built on ${dayLabel(date)} for ${build.variantName ?? task.title}, ${task.key}`}
            planned={build.plannedQty}
            builtBefore={sheetRow?.builtBefore ?? '0'}
            lockedReason={build.locked ? 'This day is closed. Owners can reopen the month.' : null}
            size="sm"
            className={cn('w-20', saving && 'opacity-60')}
            data-testid="run-built-cell"
          />
        ) : build.locked ? (
          <LockIcon reason="This day is closed." />
        ) : (
          <span className="text-xs text-fg-muted tabular-nums">{formatQty(build.builtQty)}</span>
        )}
      </span>
    </div>
  );
}

function RunBlock({ run, tasks, open, onToggle }: { readonly run: RunDTO; readonly tasks: readonly TaskSummary[]; readonly open: boolean; readonly onToggle: () => void }) {
  const { key, unit, today, moneyHidden, capabilities } = useCurrentProgram();
  const overlays = useProgramOverlays();
  const loggable = run.date <= today;
  const sheet = useOutputSheet(key, run.date, run.id, { enabled: open && loggable });
  const rows = useMemo(() => new Map((sheet.data?.rows ?? []).map((row) => [row.buildId, row])), [sheet.data]);
  const sorted = useMemo(() => [...tasks].sort((a, b) => a.position.localeCompare(b.position) || a.key.localeCompare(b.key, undefined, { numeric: true })), [tasks]);
  const isToday = run.date === today;
  return (
    <section className={cn('overflow-hidden rounded-xl border bg-panel shadow-xs', isToday ? 'border-border-default' : 'border-border-subtle')} data-testid="run-block" data-run-id={run.id} aria-label={`${dayLabel(run.date)}, ${run.name}`}>
      <div className="flex min-h-14 items-center gap-3 px-3 py-2 sm:px-4">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-focus" data-testid="run-toggle">
          {open ? <ChevronDown aria-hidden className="size-4 shrink-0 text-icon" /> : <ChevronRight aria-hidden className="size-4 shrink-0 text-icon" />}
          <RunRing done={run.done} total={run.builds} size={28} label={`${run.done} of ${run.builds} builds done in ${run.name}`} />
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span className="shrink-0 text-sm font-semibold text-fg">{dayLabel(run.date)}</span>
              {isToday ? <span className="rounded-full bg-primary-subtle px-1.5 py-px text-2xs font-semibold text-primary-text">Today</span> : null}
              <span aria-hidden className="text-fg-muted max-sm:hidden">·</span>
              <span className="min-w-0 truncate text-sm font-medium text-fg max-sm:basis-full" title={run.name}>
                {run.name}
              </span>
            </span>
            <span className="text-xs text-fg-secondary tabular-nums">
              {qtyOfText(run.builtUnits, run.plannedUnits, unit)} · {doneOfText(run.done, run.builds, 'done')}
              {run.cancelled ? ` · ${run.cancelled} cancelled` : ''}
            </span>
          </span>
        </button>
        <Badge tone={RUN_STATE_TONE[run.state]} size="sm" className="shrink-0 max-sm:hidden">
          {RUN_STATE_TEXT[run.state]}
        </Badge>
        {!moneyHidden && run.revenueCents !== null && (run.revenueCents !== '0' || run.done > 0) ? <MoneyText cents={run.revenueCents} className="w-24 shrink-0 text-right text-sm font-semibold text-fg max-sm:hidden" /> : null}
        {capabilities.canLog && loggable ? (
          <Tooltip content="Log output for this run">
            <Button size="sm" variant="secondary" leadingIcon={<ClipboardPen aria-hidden />} onClick={() => overlays.openLog({ date: run.date, run: run.id })} className="shrink-0 max-md:hidden" data-testid="run-log">
              Log run
            </Button>
          </Tooltip>
        ) : null}
        <RunMenu run={run} />
      </div>
      {open ? (
        <div role="grid" aria-label={`Builds in ${run.name}`}>
          <div role="row" className="hidden h-8 items-center gap-3 border-t border-border-subtle bg-sunken/50 pr-3 pl-12 text-2xs font-semibold tracking-wide text-fg-muted uppercase sm:flex">
            <span className="flex-1">Build</span>
            <span className="w-6" />
            <span className="w-44">Built</span>
            {!moneyHidden ? <span className="w-24 text-right max-lg:hidden">Revenue</span> : null}
            <span className="w-28 text-right">{loggable ? (run.date === today ? 'Built today' : `Built ${dayLabel(run.date)}`) : 'Built'}</span>
          </div>
          {sorted.map((task) => (
            <BuildRow key={task.id} task={task} sheetRow={rows.get(task.id)} date={run.date} onSaved={() => void sheet.refetch()} />
          ))}
          {sorted.length === 0 ? <p className="border-t border-border-subtle px-12 py-3 text-sm text-fg-muted">These builds are hidden by the filters.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function RunsView({ tasks, range, isLoading, toolbar }: { readonly tasks: readonly TaskSummary[]; readonly range: { readonly from: IsoDate; readonly to: IsoDate }; readonly isLoading: boolean; readonly toolbar: React.ReactNode }) {
  const { key, today } = useCurrentProgram();
  const extras = useCardExtras();
  const runs = useProgramRuns(key, range);
  const visible = useMemo(() => tasks.filter((task) => buildOf(task) && (!extras.filter || extras.filter(task))), [extras, tasks]);
  const byRun = useMemo(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const task of visible) {
      const runId = buildOf(task)!.runId;
      map.set(runId, [...(map.get(runId) ?? []), task]);
    }
    return map;
  }, [visible]);
  const filtering = (extras.extraFilterCount ?? 0) > 0;
  const list = useMemo(() => [...(runs.data ?? [])].filter((run) => !filtering || byRun.has(run.id)).sort((a, b) => (a.date === b.date ? Number(a.scheduleId === null) - Number(b.scheduleId === null) : b.date.localeCompare(a.date))), [byRun, filtering, runs.data]);
  const [open, setOpen] = useState<Set<string> | null>(null);
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current || !runs.data) return;
    initialised.current = true;
    const stored = readOpen(key);
    const todays = runs.data.filter((run) => run.date === today).map((run) => run.id);
    // A day with no run today opens the newest run instead.
    setOpen(stored ?? new Set(todays.length ? todays : runs.data.slice(-1).map((run) => run.id)));
  }, [key, runs.data, today]);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.sessionStorage.setItem(OPEN_KEY(key), JSON.stringify([...next]));
      } catch {
        // Storage can be off; the open state then lasts for this page only.
      }
      return next;
    });

  return (
    <div className="flex h-full min-h-[420px] flex-col" data-testid="runs-view">
      {toolbar}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-3">
          {runs.isPending || isLoading ? (
            [0, 1, 2].map((index) => (
              <div key={index} className="flex h-14 items-center gap-3 rounded-xl border border-border-subtle bg-panel px-4">
                <Skeleton width={28} height={28} rounded="full" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton width={280} height={12} rounded="full" />
                  <Skeleton width={180} height={10} rounded="full" />
                </div>
              </div>
            ))
          ) : list.length === 0 ? (
            extras.renderEmpty?.()
          ) : (
            list.map((run) => <RunBlock key={run.id} run={run} tasks={byRun.get(run.id) ?? []} open={open?.has(run.id) ?? false} onToggle={() => toggle(run.id)} />)
          )}
        </div>
      </div>
    </div>
  );
}
