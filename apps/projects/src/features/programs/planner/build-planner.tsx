'use client';
/**
 * Plan builds (docs/programs/SPEC.md 5.10): `?plan=week|day|2weeks[&from=]`. A full screen matrix
 * of variants by days for the planned qty of NEW builds; existing builds show as chips that open
 * the drawer. Days off are shaded with their name, closed days hatched and read only.
 *
 * - Fill: Copy yesterday, Copy last week, Apply schedule, Use default qty, Suggest from history
 *   (tinted "suggested" until edited). Bring in: paste from a spreadsheet or a CSV, with a preview
 *   of the cells and the rows that did not match. Clear all.
 * - Keys: arrows move, Mod D fills right, Mod Shift D fills down, typing fills the selection,
 *   Delete clears, Mod V pastes a block, Mod Enter creates. Click and drag selects a block.
 * - WMS kit capacity tints rows that plan more than WMS can build (read only).
 * - Right rail: new builds, units, planned revenue, hours against the daily capacity, by day,
 *   Assign to, the title preview and "One build per variant per day".
 * - Create runs `createBuildsAction` with Undo.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, ClipboardPaste, Eraser, FileUp, Lock, PanelRightClose, PanelRightOpen, Percent, Sparkles, Wand2, X } from 'lucide-react';
import { addDays, formatCents, formatHours, formatQty, fromScaled, parsePlanCsv, parsePlanPaste, unitLabel } from '@kitstak/programs-engine';
import {
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Kbd,
  Skeleton,
  Switch,
  Textarea,
  ToggleGroup,
  Tooltip,
  UserPicker,
  cn,
  toast,
  useModKey,
} from '@/components/ui';
import { useOrgCalendar, usePlannerCapacity, useProgram, useSchedules, useVariants, programInvalidations } from '@/lib/hooks/use-programs';
import { usePeople } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import type { IsoDate } from '@/lib/program-types';
import { createBuildsAction, undoCreateBuildsAction } from '@/server/actions/builds';
import { ProgramChip, VariantDot } from '../kit/chips';
import { dayLabel, rangeLabel } from '../kit/format';
import { readQty } from '../kit/qty-input';
import { buildOf } from '../builds/builds-model';
import { useBuildTasks } from '../builds/use-build-tasks';
import {
  addTenPercent,
  applySchedule,
  cellKey,
  copyFrom,
  dayInfo,
  daysFor,
  existingByCell,
  fillDefaultQty,
  fillDown,
  fillRight,
  rowsToCreate,
  setBlock,
  shiftFrom,
  suggestFromHistory,
  titlePreview,
  totalsOf,
  type Block,
  type ExistingBuild,
  type PlanMode,
  type PlannerVariant,
} from './planner-model';

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly message: string } };

interface Pos {
  readonly row: number;
  readonly col: number;
}

export function BuildPlanner({ programKey, mode: initialMode, from: initialFrom, onClose }: { readonly programKey: string; readonly mode: PlanMode; readonly from: IsoDate | null; readonly onClose: () => void }) {
  const program = useProgram(programKey, { staleTime: 30_000 });
  const variantsQuery = useVariants(programKey, false, { staleTime: 60_000 });
  const ready = program.data && variantsQuery.data;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        className="top-3 left-3 h-[calc(100dvh-24px)] max-h-none w-[calc(100vw-24px)] translate-x-0 translate-y-0 rounded-2xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:w-screen max-sm:rounded-none"
        data-testid="build-planner"
      >
        {ready ? (
          <PlannerBody programKey={programKey} initialMode={initialMode} initialFrom={initialFrom ?? program.data.calendar.today} onClose={onClose} />
        ) : (
          <div className="flex flex-1 flex-col" aria-busy="true" aria-label="Loading the planner">
            <div className="flex h-14 items-center gap-3 border-b border-border-subtle px-5">
              <Skeleton width={140} height={16} rounded="full" />
            </div>
            <div className="flex flex-col gap-2 p-5">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <Skeleton key={index} height={36} rounded="md" />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlannerBody({ programKey, initialMode, initialFrom, onClose }: { readonly programKey: string; readonly initialMode: PlanMode; readonly initialFrom: IsoDate; readonly onClose: () => void }) {
  const queryClient = useQueryClient();
  const mod = useModKey();
  const program = useProgram(programKey).data!;
  const allVariants = useVariants(programKey, false).data!;
  const schedules = useSchedules(programKey, { staleTime: 60_000 });
  const orgCalendar = useOrgCalendar();
  const people = usePeople();
  const { openTask } = useTaskDrawer();
  const unit = program.unit;
  const moneyHidden = program.moneyHidden || !program.capabilities.seesMoney;
  const today = program.calendar.today;
  const [mode, setMode] = useState<PlanMode>(initialMode);
  const [from, setFrom] = useState<IsoDate>(initialFrom);
  const days = useMemo(() => daysFor(mode, from), [from, mode]);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const variants = useMemo<PlannerVariant[]>(
    () =>
      allVariants
        .filter((variant) => variant.status === 'active')
        .map((variant) => ({ id: variant.id, name: variant.name, defaultQty: variant.defaultQty, unitPrice: variant.currentRate && variant.currentRate.source !== 'none' ? variant.currentRate.unitPrice : null, stdMinutesPerUnit: variant.stdMinutesPerUnit })),
    [allVariants],
  );
  const variantMeta = useMemo(() => new Map(allVariants.map((variant) => [variant.id, variant])), [allVariants]);

  const holidays = useMemo(() => new Map((orgCalendar.data?.holidays ?? []).map((holiday) => [holiday.date, holiday.name])), [orgCalendar.data]);
  const infos = useMemo(() => days.map((date) => dayInfo(date, program.calendar, holidays, program.locks.lockedThrough)), [days, holidays, program.calendar, program.locks.lockedThrough]);
  const infoOf = useCallback((date: IsoDate) => infos.find((info) => info.date === date), [infos]);

  const existingQuery = useBuildTasks(programKey, { from: first, to: last });
  const historyQuery = useBuildTasks(programKey, { from: addDays(first, -28), to: addDays(first, -1) });
  const toExisting = (tasks: readonly import('@/lib/types').TaskSummary[] | undefined): ExistingBuild[] =>
    (tasks ?? []).flatMap((task) => {
      const build = buildOf(task);
      return build ? [{ id: task.id, key: task.key, variantId: build.variantId, date: build.buildDate, plannedQty: build.plannedQty, builtQty: build.builtQty, cancelled: task.statusCategory === 'cancelled' }] : [];
    });
  const existingList = useMemo(() => toExisting(existingQuery.source.tasks), [existingQuery.source.tasks]);
  const historyList = useMemo(() => toExisting(historyQuery.source.tasks), [historyQuery.source.tasks]);
  const existing = useMemo(() => existingByCell(existingList), [existingList]);
  const history = useMemo(() => existingByCell(historyList), [historyList]);
  const capacity = usePlannerCapacity(programKey, first, last);

  const [cells, setCellsRaw] = useState<Map<string, string>>(new Map());
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [past, setPast] = useState<Map<string, string>[]>([]);
  const setCells = (next: Map<string, string>, keepSuggested = false) => {
    setPast((list) => [...list.slice(-20), cells]);
    setCellsRaw(next);
    if (!keepSuggested) setSuggested((current) => new Set([...current].filter((key) => next.get(key) === cells.get(key))));
  };
  const [anchor, setAnchor] = useState<Pos>({ row: 0, col: Math.max(0, days.indexOf(today)) });
  const [focus, setFocus] = useState<Pos>(anchor);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [onePerDay, setOnePerDay] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bringIn, setBringIn] = useState<'paste' | 'csv' | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const block: Block = useMemo(() => {
    const r0 = Math.min(anchor.row, focus.row);
    const r1 = Math.max(anchor.row, focus.row);
    const c0 = Math.min(anchor.col, focus.col);
    const c1 = Math.max(anchor.col, focus.col);
    return { rows: variants.slice(r0, r1 + 1).map((variant) => variant.id), days: days.slice(c0, c1 + 1) };
  }, [anchor, days, focus, variants]);
  const inBlock = (row: number, col: number) => row >= Math.min(anchor.row, focus.row) && row <= Math.max(anchor.row, focus.row) && col >= Math.min(anchor.col, focus.col) && col <= Math.max(anchor.col, focus.col);
  const multi = block.rows.length * block.days.length > 1;

  // Cells under an existing build are never created, so they never count.
  const totals = useMemo(() => totalsOf(new Map([...cells].filter(([key]) => !existing.has(key))), variants, days), [cells, days, existing, variants]);
  const plan = useMemo(() => rowsToCreate(cells, variants, infos, existing, { onePerDay, assigneeId }), [assigneeId, cells, existing, infos, onePerDay, variants]);
  const capacityHours = orgCalendar.data?.dailyCapacityHours ?? null;
  const shortRows = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of capacity.data?.variants ?? []) {
      if (!entry.available || entry.canBuild === null) continue;
      const existingUnits = existingList.filter((build) => build.variantId === entry.variantId && !build.cancelled).reduce((sum, build) => sum + Number(build.plannedQty), 0);
      const newUnits = Number(fromScaled(totals.byRow.get(entry.variantId) ?? BigInt(0), 3));
      if (existingUnits + newUnits > entry.canBuild) {
        const short = entry.firstShort;
        map.set(entry.variantId, `WMS can build ${formatQty(String(entry.canBuild))}${short ? ` · short ${formatQty(short.short)} of ${short.component.sku}` : ''}`);
      }
    }
    return map;
  }, [capacity.data, existingList, totals.byRow]);

  const moveFocus = (row: number, col: number, extend: boolean) => {
    const next = { row: Math.max(0, Math.min(variants.length - 1, row)), col: Math.max(0, Math.min(days.length - 1, col)) };
    setFocus(next);
    if (!extend) setAnchor(next);
    setEditing(null);
  };

  const editable = (row: number, col: number) => {
    const info = infos[col];
    const variant = variants[row];
    return Boolean(info && variant && !info.locked && !existing.has(cellKey(variant.id, info.date)));
  };

  const create = async () => {
    if (plan.rows.length === 0) return;
    setBusy(true);
    const result = (await createBuildsAction({ key: programKey, rows: plan.rows.map((row) => ({ ...row })) })) as Result<{ createdIds: string[]; skipped: { reason: string }[] }>;
    setBusy(false);
    for (const key of programInvalidations(programKey)) void queryClient.invalidateQueries({ queryKey: key });
    if (!result.ok) {
      toast.error("Couldn't create the builds", result.error.message);
      return;
    }
    const created = result.data.createdIds;
    const skipped = result.data.skipped.length + plan.alreadyExisted;
    toast.undo(`Created ${created.length} ${created.length === 1 ? 'build' : 'builds'}.${skipped ? ` ${skipped} already existed or were refused.` : ''}`, {
      onUndo: async () => {
        const back = (await undoCreateBuildsAction({ ids: created })) as Result<{ removed: number; kept: number }>;
        for (const key of programInvalidations(programKey)) void queryClient.invalidateQueries({ queryKey: key });
        if (!back.ok) toast.error("Couldn't undo", back.error.message);
        else toast.success(back.data.kept ? `Removed ${back.data.removed} builds. Kept ${back.data.kept} that got output, time or comments.` : `Removed ${back.data.removed} builds`);
      },
    });
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing && !['Enter', 'Tab', 'Escape'].includes(event.key)) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key === 'Enter') {
      event.preventDefault();
      void create();
      return;
    }
    if (meta && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      setCells(event.shiftKey ? fillDown(cells, block, infoOf) : fillRight(cells, block, infoOf));
      return;
    }
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      const previous = past.at(-1);
      if (previous) {
        setCellsRaw(previous);
        setPast((list) => list.slice(0, -1));
      }
      return;
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const dr = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      const dc = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      moveFocus(focus.row + dr, focus.col + dc, event.shiftKey);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      if (event.key === 'Tab') moveFocus(focus.row, focus.col + (event.shiftKey ? -1 : 1), false);
      else moveFocus(focus.row + (event.shiftKey ? -1 : 1), focus.col, false);
      return;
    }
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      setEditing(null);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      setCells(setBlock(cells, block, '', infoOf));
      return;
    }
    if (/^[0-9.]$/.test(event.key) && !meta) {
      event.preventDefault();
      if (multi) setCells(setBlock(cells, block, event.key, infoOf));
      else if (editable(focus.row, focus.col)) {
        const key = cellKey(variants[focus.row]!.id, days[focus.col]!);
        setCells(new Map(cells).set(key, event.key));
        setEditing(key);
      }
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const textData = event.clipboardData.getData('text/plain');
    if (!textData) return;
    event.preventDefault();
    const lines = textData.replace(/\r/g, '').split('\n').filter((line, index, list) => line !== '' || index < list.length - 1);
    const next = new Map(cells);
    let filled = 0;
    lines.forEach((line, r) => {
      line.split('\t').forEach((value, c) => {
        const row = variants[focus.row + r];
        const day = days[focus.col + c];
        if (!row || !day || !editable(focus.row + r, focus.col + c)) return;
        next.set(cellKey(row.id, day), value.trim());
        filled += 1;
      });
    });
    setCells(next);
    toast.success(`Pasted ${filled} ${filled === 1 ? 'cell' : 'cells'}`);
  };

  useEffect(() => {
    gridRef.current?.focus();
  }, []);
  useEffect(() => {
    const stop = () => setDragging(false);
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  const scheduleList = schedules.data?.filter((schedule) => schedule.status === 'active') ?? [];
  const firstNew = plan.rows[0];
  const preview = firstNew ? titlePreview(program.settings.buildTitlePattern, variantMeta.get(firstNew.variantId)?.name ?? '', dayLabel(firstNew.buildDate).slice(4), program.key) : null;
  const dayMax = Math.max(1, ...days.map((day) => Number(fromScaled(totals.byDay.get(day) ?? BigInt(0), 3))));
  const invalidCells = totals.invalid;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header (56px) */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-5 max-sm:h-auto max-sm:flex-wrap max-sm:px-3 max-sm:py-2">
        <CalendarRange aria-hidden className="size-5 text-icon" />
        <h2 className="text-lg font-semibold text-fg">Plan builds</h2>
        <ProgramChip program={program} link={false} size="sm" />
        <ToggleGroup<PlanMode>
          size="sm"
          label="Days shown"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: '2weeks', label: '2 weeks' },
          ]}
        />
        <span className="flex items-center gap-0.5">
          <IconButton size="sm" label="Earlier" icon={<ChevronLeft aria-hidden />} onClick={() => setFrom(shiftFrom(mode, from, -1))} />
          <span className="min-w-[132px] text-center text-sm font-medium text-fg tabular-nums">{rangeLabel(first, last)}</span>
          <IconButton size="sm" label="Later" icon={<ChevronRight aria-hidden />} onClick={() => setFrom(shiftFrom(mode, from, 1))} />
        </span>
        <Button size="sm" variant="ghost" onClick={() => setFrom(today)}>
          This week
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="secondary" leadingIcon={<Wand2 aria-hidden />} data-testid="planner-actions">
              Fill
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Fill</DropdownMenuLabel>
            <DropdownMenuItem description="Each day gets the day before's plan" onSelect={() => setCells(copyFrom(cells, variants, infos, existing, history, -1))}>
              Copy yesterday
            </DropdownMenuItem>
            <DropdownMenuItem description="Each day gets the same weekday last week" onSelect={() => setCells(copyFrom(cells, variants, infos, existing, history, -7))}>
              Copy last week
            </DropdownMenuItem>
            {scheduleList.length ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Apply schedule</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-64">
                  {scheduleList.map((schedule) => (
                    <DropdownMenuItem key={schedule.id} description={schedule.text} onSelect={() => setCells(applySchedule(cells, { pattern: schedule.pattern, days: schedule.days, lines: schedule.lines.map((line) => ({ variantId: line.variantId, qty: line.qty, qtyByWeekday: line.qtyByWeekday })) }, infos, existing, program.calendar))}>
                      {schedule.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuItem description="Fills empty cells on work days" onSelect={() => setCells(fillDefaultQty(cells, variants, infos, existing))}>
              Use default qty
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<Sparkles aria-hidden />}
              description="Average built per weekday, last 4 weeks"
              onSelect={() => {
                const result = suggestFromHistory(cells, variants, infos, existing, historyList);
                setCells(result.cells, true);
                setSuggested(new Set([...suggested, ...result.suggested]));
                if (result.suggested.size === 0) toast.info('No history to suggest from', 'Builds from the last 4 weeks fill this in.');
              }}
            >
              Suggest from history
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Bring in</DropdownMenuLabel>
            <DropdownMenuItem icon={<ClipboardPaste aria-hidden />} description="Rows are variants or SKUs, columns are dates" onSelect={() => setBringIn('paste')}>
              Paste from spreadsheet
            </DropdownMenuItem>
            <DropdownMenuItem icon={<FileUp aria-hidden />} description="Columns: date, SKU or variant, qty" onSelect={() => setBringIn('csv')}>
              Import CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Clear</DropdownMenuLabel>
            <DropdownMenuItem icon={<Eraser aria-hidden />} variant="danger" onSelect={() => setCells(new Map())}>
              Clear all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        <IconButton size="sm" label={railOpen ? 'Hide summary' : 'Show summary'} icon={railOpen ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />} onClick={() => setRailOpen((open) => !open)} className="max-lg:hidden" />
        <IconButton size="sm" label="Close the planner" icon={<X aria-hidden />} onClick={onClose} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Matrix */}
        <div className="relative min-w-0 flex-1 overflow-auto" data-testid="planner-scroll">
          {multi ? (
            <div className="sticky top-2 left-1/2 z-[3] mx-auto -mb-10 flex w-fit items-center gap-1 rounded-lg border border-border-subtle bg-raised p-1 shadow-popover" data-testid="planner-selection-bar">
              <span className="px-2 text-xs text-fg-muted tabular-nums">{block.rows.length * block.days.length} cells</span>
              <SetQtyButton onSet={(value) => setCells(setBlock(cells, block, value, infoOf))} />
              <Button size="xs" variant="ghost" leadingIcon={<Percent aria-hidden />} onClick={() => setCells(addTenPercent(cells, block))}>
                Add 10 percent
              </Button>
              <Button size="xs" variant="ghost" leadingIcon={<Eraser aria-hidden />} onClick={() => setCells(setBlock(cells, block, '', infoOf))}>
                Clear
              </Button>
            </div>
          ) : null}
          <div
            ref={gridRef}
            role="grid"
            tabIndex={0}
            aria-label={`Planned ${unit.plural} by variant and day`}
            aria-rowcount={variants.length + 2}
            aria-colcount={days.length + 2}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="flex min-w-full flex-col outline-none"
          >
            <div role="row" aria-rowindex={1} className="sticky top-0 z-[2] flex border-b border-border-subtle bg-raised">
              <div role="columnheader" className="sticky left-0 z-[1] flex w-60 shrink-0 items-end border-r border-border-subtle bg-raised px-4 py-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase max-sm:w-40">
                Variant
              </div>
              {infos.map((info, col) => (
                <div
                  key={info.date}
                  role="columnheader"
                  aria-colindex={col + 2}
                  className={cn('flex min-w-[112px] flex-1 basis-[112px] flex-col justify-end border-r border-border-subtle px-2 py-1.5 text-right', !info.work && 'bg-sunken', info.date === today && 'shadow-[inset_0_-2px_0_var(--primary)]')}
                >
                  <span className={cn('text-xs font-semibold', info.date === today ? 'text-primary-text' : 'text-fg')}>{dayLabel(info.date)}</span>
                  <span className="truncate text-2xs text-fg-muted tabular-nums">
                    {info.locked ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Lock aria-hidden className="size-3" /> Closed
                      </span>
                    ) : info.offName ? (
                      info.offName
                    ) : (
                      unitLabel(fromScaled((totals.byDay.get(info.date) ?? BigInt(0)) + existingList.filter((build) => build.date === info.date && !build.cancelled).reduce((sum, build) => sum + BigInt(Math.round(Number(build.plannedQty) * 1000)), BigInt(0)), 3), unit)
                    )}
                  </span>
                </div>
              ))}
              <div role="columnheader" className="flex w-24 shrink-0 items-end justify-end px-3 py-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                New total
              </div>
            </div>
            {variants.length === 0 ? <p className="px-6 py-10 text-sm text-fg-muted">This program has no active variants yet. Add variants on the Variants tab, then plan builds.</p> : null}
            {variants.map((variant, row) => {
              const meta = variantMeta.get(variant.id);
              const short = shortRows.get(variant.id);
              const rowTotal = totals.byRow.get(variant.id) ?? BigInt(0);
              return (
                <div key={variant.id} role="row" aria-rowindex={row + 2} className={cn('flex border-b border-border-subtle', short && 'bg-warning-subtle/40')} data-testid="planner-row" data-variant={variant.name}>
                  <div role="rowheader" className={cn('sticky left-0 z-[1] flex w-60 shrink-0 items-center gap-2 border-r border-border-subtle px-4 py-1.5 max-sm:w-40', short ? 'bg-[color-mix(in_srgb,var(--surface-raised),var(--warning-subtle)_50%)]' : 'bg-raised')}>
                    <VariantDot color={meta?.color} size={8} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{variant.name}</span>
                      <span className="block truncate text-2xs text-fg-muted">
                        {meta?.sku ? <span className="font-key">{meta.sku}</span> : null}
                        {meta?.sku && variant.defaultQty ? ' · ' : ''}
                        {variant.defaultQty ? `default ${formatQty(variant.defaultQty)}` : ''}
                      </span>
                    </span>
                  </div>
                  {infos.map((info, col) => {
                    const key = cellKey(variant.id, info.date);
                    const builds = existing.get(key);
                    const value = cells.get(key) ?? '';
                    const selected = inBlock(row, col);
                    const isFocus = focus.row === row && focus.col === col;
                    const bad = value.trim() !== '' && !readQty(value).ok;
                    return (
                      <div
                        key={info.date}
                        role="gridcell"
                        aria-colindex={col + 2}
                        aria-selected={selected}
                        aria-readonly={!editable(row, col)}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return;
                          setDragging(true);
                          moveFocus(row, col, event.shiftKey);
                          gridRef.current?.focus();
                        }}
                        onMouseEnter={() => dragging && moveFocus(row, col, true)}
                        onDoubleClick={() => editable(row, col) && setEditing(key)}
                        className={cn(
                          'relative flex h-11 min-w-[112px] flex-1 basis-[112px] items-center justify-end gap-1 border-r border-border-subtle px-2 text-sm tabular-nums select-none',
                          !info.work && 'bg-sunken',
                          info.locked && 'bg-[repeating-linear-gradient(135deg,var(--surface-sunken)_0_4px,transparent_4px_8px)] text-fg-muted',
                          short && !builds && 'bg-warning-subtle/60',
                          suggested.has(key) && value && 'bg-info-subtle/60 italic',
                          selected && 'bg-primary-selected',
                          isFocus && 'shadow-[inset_0_0_0_2px_var(--focus-ring)]',
                          bad && 'text-danger-text',
                        )}
                        data-testid="planner-cell"
                      >
                        {builds ? (
                          <button
                            type="button"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => openTask(builds[0]!.key)}
                            title={`${builds.map((build) => build.key).join(', ')} already planned`}
                            className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border-subtle bg-panel px-1.5 py-0.5 text-2xs text-fg-secondary hover:border-border-default"
                          >
                            <span className="shrink-0 font-medium text-fg tabular-nums">{formatQty(builds.reduce((sum, build) => sum + Number(build.plannedQty), 0).toString())}</span>
                            <span className="truncate font-key text-fg-muted">{builds.length > 1 ? `${builds.length} builds` : builds[0]!.key}</span>
                          </button>
                        ) : editing === key ? (
                          <input
                            autoFocus
                            inputMode="decimal"
                            aria-label={`Planned ${unit.plural} of ${variant.name} on ${dayLabel(info.date)}`}
                            value={value}
                            onChange={(event) => setCellsRaw(new Map(cells).set(key, event.target.value))}
                            onBlur={() => setEditing(null)}
                            className="h-8 w-full rounded-sm border border-primary bg-panel px-1.5 text-right text-sm outline-none"
                          />
                        ) : (
                          <span className={cn(!value && 'text-fg-placeholder')}>{value ? formatQty(readQty(value).ok ? (readQty(value) as { qty: string | null }).qty ?? '0' : '0') || value : info.locked || !info.work ? '' : ''}</span>
                        )}
                        {suggested.has(key) && value ? <span className="absolute top-0.5 left-1.5 text-[9px] font-medium tracking-wide text-info-text not-italic uppercase">suggested</span> : null}
                      </div>
                    );
                  })}
                  <div className="flex w-24 shrink-0 items-center justify-end gap-1 px-3 text-sm font-medium text-fg tabular-nums">
                    {short ? (
                      <Tooltip content={short}>
                        <span tabIndex={0} aria-label={short} className="inline-flex text-warning">
                          <AlertTriangle aria-hidden className="size-3.5" />
                        </span>
                      </Tooltip>
                    ) : null}
                    {rowTotal > BigInt(0) ? formatQty(fromScaled(rowTotal, 3)) : ''}
                  </div>
                </div>
              );
            })}
            <div role="row" className="sticky bottom-0 z-[2] flex border-t border-border-default bg-raised">
              <div className="sticky left-0 z-[1] flex w-60 shrink-0 items-center border-r border-border-subtle bg-raised px-4 py-2 text-xs font-semibold text-fg-secondary max-sm:w-40">New builds by day</div>
              {infos.map((info) => (
                <div key={info.date} className="flex min-w-[112px] flex-1 basis-[112px] items-center justify-end border-r border-border-subtle px-2 py-2 text-xs font-semibold text-fg tabular-nums">
                  {(totals.byDay.get(info.date) ?? BigInt(0)) > BigInt(0) ? formatQty(fromScaled(totals.byDay.get(info.date)!, 3)) : ''}
                </div>
              ))}
              <div className="flex w-24 shrink-0 items-center justify-end px-3 text-xs font-semibold text-fg tabular-nums">{formatQty(totals.units)}</div>
            </div>
          </div>
        </div>

        {/* Right rail (280px) */}
        {railOpen ? (
          <aside className="flex w-[280px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-border-subtle bg-sunken/40 p-4 max-lg:hidden" aria-label="Summary" data-testid="planner-rail">
            <section>
              <h3 className="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Summary</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">
                <div>
                  <dt className="text-xs text-fg-muted">New builds</dt>
                  <dd className="text-lg font-semibold text-fg tabular-nums">{plan.rows.length}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">Units</dt>
                  <dd className="text-lg font-semibold text-fg tabular-nums">{unitLabel(totals.units, unit)}</dd>
                </div>
                {!moneyHidden ? (
                  <div className="col-span-2">
                    <dt className="text-xs text-fg-muted">Planned revenue</dt>
                    <dd className="text-lg font-semibold text-fg tabular-nums">{formatCents(totals.revenueCents, { cents: true })}</dd>
                  </div>
                ) : null}
                {totals.hours !== null ? (
                  <div className="col-span-2">
                    <dt className="text-xs text-fg-muted">Estimated hours</dt>
                    <dd className="text-sm font-semibold text-fg tabular-nums">
                      {formatHours(totals.hours)}
                      {capacityHours ? <span className="block text-xs font-normal text-fg-secondary">Busiest day {formatHours(fromScaled([...totals.hoursByDay.values()].reduce((max, value) => (value > max ? value : max), BigInt(0)), 2))} of {formatHours(capacityHours)} a day</span> : null}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
            <section>
              <h3 className="text-2xs font-semibold tracking-wide text-fg-muted uppercase">By day</h3>
              <div className="mt-2 flex h-16 items-end gap-1" aria-hidden>
                {infos.map((info) => {
                  const value = Number(fromScaled(totals.byDay.get(info.date) ?? BigInt(0), 3));
                  return <span key={info.date} className="flex-1 rounded-t-sm" style={{ height: `${Math.max(4, (value / dayMax) * 64)}px`, background: value ? 'var(--chart-1)' : 'var(--border-subtle)' }} title={`${dayLabel(info.date)}: ${unitLabel(String(value), unit)}`} />;
                })}
              </div>
              <div className="mt-1 flex gap-1 text-[10px] text-fg-muted">
                {infos.map((info) => (
                  <span key={info.date} className="flex-1 text-center">
                    {dayLabel(info.date).slice(0, 1)}
                  </span>
                ))}
              </div>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-2xs font-semibold tracking-wide text-fg-muted uppercase">New builds get</h3>
              <label className="flex flex-col gap-1 text-xs text-fg-secondary">
                Assign to
                <UserPicker value={assigneeId} onChange={setAssigneeId} people={(people.data ?? []).map((person) => ({ id: person.id, name: person.name, email: person.email, image: person.image }))} placeholder="No one" />
              </label>
              <div className="text-xs text-fg-secondary">
                Title
                <p className="mt-0.5 truncate rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-sm text-fg" title={preview ?? undefined}>
                  {preview ?? 'Type a qty to see a title'}
                </p>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm text-fg">
                <span>
                  One build per variant per day
                  <span className="block text-xs text-fg-muted">Cells that already have a build are skipped</span>
                </span>
                <Switch checked={onePerDay} onCheckedChange={setOnePerDay} aria-label="One build per variant per day" />
              </label>
            </section>
            <section className="mt-auto text-xs text-fg-muted">
              <p>
                <Kbd>{mod}</Kbd> <Kbd>D</Kbd> fill right · <Kbd>{mod}</Kbd> <Kbd>Shift</Kbd> <Kbd>D</Kbd> fill down · <Kbd>{mod}</Kbd> <Kbd>V</Kbd> paste a block
              </p>
            </section>
          </aside>
        ) : null}
      </div>

      {/* Footer (64px) */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-t border-border-subtle px-5 max-sm:px-3">
        <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary tabular-nums">
          {invalidCells ? <span className="font-medium text-danger-text">{invalidCells} {invalidCells === 1 ? 'cell is' : 'cells are'} not a number. </span> : null}
          {plan.rows.length ? `${plan.rows.length} new ${plan.rows.length === 1 ? 'build' : 'builds'} · ${unitLabel(totals.units, unit)}` : 'Type planned qty in the cells, or use Fill.'}
          {plan.alreadyExisted ? ` · ${plan.alreadyExisted} already planned` : ''}
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Tooltip content={<span className="flex items-center gap-1.5">Create builds <Kbd>{mod}</Kbd><Kbd>Enter</Kbd></span>}>
          <Button onClick={() => void create()} loading={busy} disabled={plan.rows.length === 0 || invalidCells > 0} data-testid="planner-create">
            {plan.rows.length ? `Create ${plan.rows.length} ${plan.rows.length === 1 ? 'build' : 'builds'}` : 'Create builds'}
          </Button>
        </Tooltip>
      </div>

      {bringIn ? (
        <BringInDialog
          kind={bringIn}
          variants={allVariants.filter((variant) => variant.status === 'active').map((variant) => ({ id: variant.id, key: variant.key, name: variant.name, sku: variant.sku }))}
          dates={days}
          onClose={() => setBringIn(null)}
          onApply={(filled) => {
            const next = new Map(cells);
            let count = 0;
            for (const cell of filled) {
              const info = infoOf(cell.date);
              if (!info || info.locked || existing.has(cellKey(cell.variantId, cell.date))) continue;
              next.set(cellKey(cell.variantId, cell.date), formatQty(cell.qty).replace(/,/g, ''));
              count += 1;
            }
            setCells(next);
            setBringIn(null);
            toast.success(`Filled ${count} ${count === 1 ? 'cell' : 'cells'}`);
          }}
        />
      ) : null}
    </div>
  );
}

function SetQtyButton({ onSet }: { readonly onSet: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <span className="flex items-center gap-1">
      <Input size="sm" aria-label="Qty for the selected cells" placeholder="Qty" value={value} onChange={(event) => setValue(event.target.value)} containerClassName="w-20" onKeyDown={(event) => event.key === 'Enter' && readQty(value).ok && onSet(value)} />
      <Button size="xs" variant="secondary" disabled={!value.trim() || !readQty(value).ok} onClick={() => onSet(value)}>
        Set qty
      </Button>
    </span>
  );
}

function BringInDialog({ kind, variants, dates, onClose, onApply }: { readonly kind: 'paste' | 'csv'; readonly variants: readonly { id: string; key: string; name: string; sku: string | null }[]; readonly dates: readonly IsoDate[]; readonly onClose: () => void; readonly onApply: (cells: readonly { variantId: string; date: IsoDate; qty: string }[]) => void }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    if (kind === 'paste') {
      const result = parsePlanPaste({ text, variants, dates });
      return { cells: result.cells, unmatched: result.unmatched };
    }
    const result = parsePlanCsv({ text, variants });
    return { cells: result.rows.map((row) => ({ variantId: row.variantId, date: row.buildDate, qty: row.qty })), unmatched: result.unmatched };
  }, [dates, kind, text, variants]);
  const name = (id: string) => variants.find((variant) => variant.id === id)?.name ?? '';
  const outside = parsed ? parsed.cells.filter((cell) => !dates.includes(cell.date)).length : 0;
  const inside = parsed ? parsed.cells.filter((cell) => dates.includes(cell.date)) : [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" data-testid="planner-bring-in">
        <div className="flex flex-col gap-3 p-6">
          <h3 className="text-lg font-semibold text-fg">{kind === 'paste' ? 'Paste from a spreadsheet' : 'Import a CSV'}</h3>
          <p className="text-sm text-fg-secondary">{kind === 'paste' ? 'Copy rows from a spreadsheet: the first column is the SKU or variant, the next columns are the days shown, with a date header row.' : 'Paste or drop CSV rows with date, SKU or variant, and qty.'}</p>
          <Textarea rows={7} value={text} onChange={(event) => setText(event.target.value)} className="font-mono text-xs" aria-label={kind === 'paste' ? 'Pasted cells' : 'CSV rows'} />
          {parsed ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-fg">Will fill {inside.length} {inside.length === 1 ? 'cell' : 'cells'}</p>
                <ul className="mt-1 max-h-40 overflow-auto rounded-md border border-border-subtle text-xs">
                  {inside.slice(0, 60).map((cell) => (
                    <li key={`${cell.variantId}|${cell.date}`} className="flex justify-between gap-2 border-b border-border-subtle px-2 py-1 last:border-b-0">
                      <span className="truncate">
                        {name(cell.variantId)} · {dayLabel(cell.date)}
                      </span>
                      <span className="tabular-nums">{formatQty(cell.qty)}</span>
                    </li>
                  ))}
                </ul>
                {outside ? <p className="mt-1 text-2xs text-fg-muted">{outside} more are on days outside this range and are left out.</p> : null}
              </div>
              <div>
                <p className="text-xs font-semibold text-fg">Did not match</p>
                {parsed.unmatched.length ? (
                  <ul className="mt-1 max-h-40 overflow-auto rounded-md border border-border-subtle text-xs">
                    {parsed.unmatched.map((entry, index) => (
                      <li key={index} className="border-b border-border-subtle px-2 py-1 last:border-b-0">
                        <span className="text-fg-muted">Row {entry.line}: </span>
                        {entry.why}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-fg-muted">Every row matched.</p>
                )}
              </div>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!inside.length} onClick={() => onApply(inside)}>
              Fill {inside.length} {inside.length === 1 ? 'cell' : 'cells'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
