'use client';
/**
 * Build facts inside the shared views (docs/programs/SPEC.md 5.7): what a build card, list row,
 * table column, calendar day and timeline row show; the Run, Day and Variant groupings; the Done
 * fold; build menu items; and the bulk bar actions. `useBuildExtras` returns the value for
 * `CardExtrasProvider`.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Ban, Boxes, CalendarDays, ClipboardPen, GripVertical, Hash, Lock, Shapes, Trash2 } from 'lucide-react';
import { TASK_MIME } from '@/features/timeline/unscheduled-tray';
import { formatCents, formatQty, formatUnitPrice, fromScaled, quantityToScaled, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, cn, ProgressBar, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IsoDatePicker, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui';
import { PLANNED_FROM_LABELS, PRICE_SOURCE_LABELS } from '@/lib/constants';
import { useProgramRuns } from '@/lib/hooks/use-programs';
import type { BuildBlockDTO, IsoDate, RunDTO } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import type { CardExtrasValue, ExtraDisplay, ExtraGrouping, ExtraLane, ExtraOrder } from '@/features/views/card-extras';
import type { ColumnDef } from '@/features/table/table-columns';
import { BarButton } from '@/features/views/bulk-bar';
import { useCurrentProgram } from '../program-context';
import { LockIcon, PriceFromChip, RevenueGoesToChip, VariantChip, VariantDot } from '../kit/chips';
import { MoneyText, QtyProgress, RunRing } from '../kit/numbers';
import { dayLabel, doneOfText, qtyOfText, qtyPercent, qtyTone } from '../kit/format';
import { useProgramOverlays } from '../overlays/overlay-params';
import { BuildDangerItems, BuildMenuItems, hasOutput } from './build-menu';
import { BuiltEditor, useLogEntries } from './built-editor';
import { openBuildDialog } from './build-dialogs';
import {
  BUILD_ORDER_LABELS,
  BUILD_SHOW_KEYS,
  BUILD_SHOW_LABELS,
  buildOf,
  compareBuilds,
  dayKeyOf,
  foldsOnBoard,
  orderRunKeys,
  runKeyOf,
  TASKS_GROUP,
  totalsOf,
  variantKeyOf,
  type BuildFilters,
  type BuildOrderKey,
  type BuildShow,
} from './builds-model';
import { RunMenu } from './run-menu';
import { useBuildActions, type BuildActions } from './use-build-actions';
import { readQty, trimQty } from '../kit/qty-input';
import { OutputCell } from '../kit/output-cell';

/* --------------------------------------------------------------------------------------------- */
/* Card and row                                                                                  */
/* --------------------------------------------------------------------------------------------- */

function BuildBadges({ build }: { readonly build: BuildBlockDTO }) {
  return (
    <>
      {build.unplanned ? (
        <Badge tone="info" size="sm">
          Unplanned
        </Badge>
      ) : null}
      {build.closedShort ? (
        <Tooltip content={build.closeReason ? `Closed short: ${build.closeReason}` : 'Closed short of plan'}>
          <span tabIndex={0} className="inline-flex rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus">
            <Badge tone="warning" size="sm">
              Closed short
            </Badge>
          </span>
        </Tooltip>
      ) : null}
    </>
  );
}

const SHOW_ALL: BuildShow = { qty: true, revenue: true, rate: true, variant: true, sku: true };

function rateText(build: BuildBlockDTO, unitSingular: string): string | null {
  const price = build.currentPrice?.unitPrice;
  return price ? `${formatUnitPrice(price)} / ${unitSingular}` : null;
}

/** Build facts on a board card, under the title. `show` follows Display > Show. */
export function BuildCardFacts({ task, show = SHOW_ALL }: { readonly task: TaskSummary; readonly show?: BuildShow }) {
  const { unit, moneyHidden, key, variantById } = useCurrentProgram();
  const build = buildOf(task);
  if (!build) return null;
  const sku = show.sku && build.variantId ? variantById.get(build.variantId)?.sku ?? null : null;
  const rate = show.rate && !moneyHidden ? rateText(build, unit.singular) : null;
  const revenue = show.revenue && !moneyHidden && build.revenueCents !== null && build.revenueCents !== '0' ? build.revenueCents : null;
  const chipRow = (show.variant && build.variantName) || sku || build.unplanned || build.closedShort;
  return (
    <div className="flex flex-col gap-1.5" data-testid="build-card-facts">
      {chipRow ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {show.variant && build.variantName ? <VariantChip name={build.variantName} color={build.variantColor} sku={sku ?? undefined} /> : sku ? <span className="font-key text-2xs text-fg-muted">{sku}</span> : null}
          <BuildBadges build={build} />
        </div>
      ) : null}
      {show.qty || revenue || rate || build.locked ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          {show.qty ? <QtyProgress built={build.builtQty} planned={build.plannedQty} unit={unit} /> : <span />}
          <span className="flex shrink-0 items-center gap-1.5 text-2xs text-fg-muted">
            {build.locked ? <LockIcon reason="This day is closed. Output and prices on it cannot change." /> : null}
            {rate ? <span className="tabular-nums" data-testid="card-rate">{rate}</span> : null}
            {revenue ? <MoneyText cents={revenue} className="font-medium text-fg-secondary" /> : null}
          </span>
        </div>
      ) : null}
      {build.posting === 'unbilled' ? <RevenueGoesToChip posting="unbilled" programKey={key} /> : null}
    </div>
  );
}

/** List row cells: variant, qty progress, rate and revenue (each follows Display > Show). */
export function BuildRowCells({ task, show = SHOW_ALL }: { readonly task: TaskSummary; readonly show?: BuildShow }) {
  const { unit, moneyHidden, variantById } = useCurrentProgram();
  const build = buildOf(task);
  const sku = show.sku && build?.variantId ? variantById.get(build.variantId)?.sku ?? null : null;
  return (
    <>
      {show.variant || show.sku ? (
        <span className="flex w-36 shrink-0 items-center gap-1 px-1 max-lg:hidden">
          {show.variant && build?.variantName ? <VariantChip name={build.variantName} color={build.variantColor} sku={sku ?? undefined} className="max-w-full" /> : sku ? <span className="truncate font-key text-xs text-fg-muted">{sku}</span> : null}
          {build ? <BuildBadges build={build} /> : null}
        </span>
      ) : null}
      {show.qty ? <span className="flex w-44 shrink-0 items-center px-1 max-md:w-auto">{build ? <QtyProgress built={build.builtQty} planned={build.plannedQty} unit={unit} /> : null}</span> : null}
      {show.rate && !moneyHidden ? <span className="flex w-24 shrink-0 items-center justify-end px-1 text-xs text-fg-secondary tabular-nums max-xl:hidden">{build ? rateText(build, unit.singular) : null}</span> : null}
      {show.revenue && !moneyHidden ? (
        <span className="flex w-24 shrink-0 items-center justify-end px-1 text-sm text-fg-secondary max-xl:hidden">{build?.revenueCents && build.revenueCents !== '0' ? <MoneyText cents={build.revenueCents} /> : null}</span>
      ) : null}
    </>
  );
}

function RowCellsHeader({ show = SHOW_ALL }: { readonly show?: BuildShow }) {
  const { moneyHidden } = useCurrentProgram();
  return (
    <>
      {show.variant || show.sku ? <span className="w-36 pl-1.5 max-lg:hidden">{show.variant ? 'Variant' : 'SKU'}</span> : null}
      {show.qty ? <span className="w-44 pl-1.5 max-md:hidden">Built</span> : null}
      {show.rate && !moneyHidden ? <span className="w-24 pr-1 text-right max-xl:hidden">Rate</span> : null}
      {show.revenue && !moneyHidden ? <span className="w-24 pr-1 text-right max-xl:hidden">Revenue</span> : null}
    </>
  );
}

/* --------------------------------------------------------------------------------------------- */
/* Run groups                                                                                    */
/* --------------------------------------------------------------------------------------------- */

function runFromTasks(id: string, tasks: readonly TaskSummary[], name: string, programKey: string): RunDTO {
  const totals = totalsOf(tasks);
  const first = buildOf(tasks[0]!);
  return {
    id,
    programKey,
    date: first?.buildDate ?? '',
    name,
    scheduleId: first?.scheduleId ?? null,
    state: totals.done === totals.builds ? 'done' : totals.done > 0 ? 'in_progress' : 'planned',
    builds: totals.builds,
    done: totals.done,
    cancelled: tasks.filter((task) => task.statusCategory === 'cancelled').length,
    plannedUnits: totals.planned,
    builtUnits: totals.built,
    revenueCents: totals.revenueCents,
    buildIds: tasks.map((task) => task.id),
  };
}

/* --------------------------------------------------------------------------------------------- */
/* Calendar day                                                                                  */
/* --------------------------------------------------------------------------------------------- */

function DayPopover({ date, tasks }: { readonly date: IsoDate; readonly tasks: readonly TaskSummary[] }) {
  const { key, unit, today, capabilities, moneyHidden } = useCurrentProgram();
  const log = useLogEntries(key);
  const overlays = useProgramOverlays();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const canLog = capabilities.canLog && date <= today;
  const canMove = capabilities.canPlan;
  const builds = tasks.filter((task) => buildOf(task));
  const entries = Object.entries(values)
    .map(([buildId, text]) => ({ buildId, read: readQty(text) }))
    .filter((entry) => entry.read.ok && entry.read.qty !== null)
    .map((entry) => ({ buildId: entry.buildId, mode: 'add' as const, qty: (entry.read as { qty: string }).qty }));
  const totals = totalsOf(builds);
  const save = async () => {
    setBusy(true);
    const units = entries.reduce((sum, entry) => sum + quantityToScaled(entry.qty), BigInt(0));
    const ok = await log(date, entries, `Logged ${unitLabel(fromScaled(units, 3), unit)} on ${entries.length} ${entries.length === 1 ? 'build' : 'builds'}`);
    setBusy(false);
    if (ok) setValues({});
  };
  return (
    <div className="flex w-[340px] flex-col" data-testid="calendar-day-popover">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
        <RunRing done={totals.done} total={totals.builds} size={18} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">{dayLabel(date)}</p>
          <p className="text-xs text-fg-muted tabular-nums">
            {qtyOfText(totals.built, totals.planned, unit)} · {doneOfText(totals.done, totals.builds, 'done')}
            {!moneyHidden && totals.revenueCents ? <> · <MoneyText cents={totals.revenueCents} /></> : null}
          </p>
        </div>
      </div>
      {canMove ? <p className="px-3 pt-2 text-2xs text-fg-muted">Drag a build onto another day to move it.</p> : null}
      <ul className="max-h-72 overflow-y-auto py-1">
        {builds.map((task) => {
          const build = buildOf(task)!;
          return (
            <li
              key={task.id}
              draggable={canMove && !build.locked}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(TASK_MIME, task.id);
                event.dataTransfer.setData('text/plain', task.key);
              }}
              className={cn('group/row flex items-center gap-2 px-3 py-1.5', canMove && !build.locked && 'cursor-grab active:cursor-grabbing')}
              data-testid="calendar-day-build"
            >
              {canMove ? <GripVertical aria-hidden className={cn('-ml-1.5 size-3.5 shrink-0 text-icon', build.locked ? 'opacity-0' : 'opacity-40 group-hover/row:opacity-100')} /> : null}
              <VariantDot color={build.variantColor} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{build.variantName ?? task.title}</span>
                <span className="block text-2xs text-fg-muted tabular-nums">
                  <span className="font-key">{task.key}</span> · {qtyOfText(build.builtQty, build.plannedQty, unit)}
                </span>
              </span>
              {canLog && task.statusCategory !== 'cancelled' ? (
                <OutputCell
                  value={values[task.id] ?? ''}
                  onChange={(value) => setValues((current) => ({ ...current, [task.id]: value }))}
                  label={`Add built on ${dayLabel(date)} for ${build.variantName ?? task.title}, ${task.key}`}
                  planned={build.plannedQty}
                  builtBefore={build.builtQty}
                  lockedReason={build.locked ? 'This day is closed.' : null}
                  size="sm"
                  className="w-20"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-3 py-2">
        {canLog ? (
          <Button size="xs" variant="ghost" onClick={() => overlays.openLog({ date })}>
            Open log
          </Button>
        ) : (
          <span className="text-xs text-fg-muted">{date > today ? 'Output can be logged on the day.' : 'You can view output. Editors can log it.'}</span>
        )}
        {canLog ? (
          <Button size="xs" onClick={() => void save()} loading={busy} disabled={entries.length === 0}>
            {entries.length ? `Add to ${entries.length} ${entries.length === 1 ? 'build' : 'builds'}` : 'Add output'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DaySummary({ date, tasks }: { readonly date: IsoDate; readonly tasks: readonly TaskSummary[] }) {
  const { unit } = useCurrentProgram();
  const builds = tasks.filter((task) => buildOf(task));
  if (builds.length === 0) return null;
  const totals = totalsOf(builds);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="@container flex w-full min-w-0 items-center gap-2 rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-left shadow-xs outline-none hover:border-border-default hover:shadow-sm focus-visible:outline-2 focus-visible:outline-focus"
          data-testid="calendar-day-stack"
          aria-label={`${dayLabel(date)}: ${totals.builds} builds, ${qtyOfText(totals.built, totals.planned, unit)}, ${doneOfText(totals.done, totals.builds, 'done')}`}
        >
          <RunRing done={totals.done} total={totals.builds} size={18} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-fg tabular-nums">
              {totals.builds} {totals.builds === 1 ? 'build' : 'builds'}
              <span className="@max-[125px]:hidden"> · {unitLabel(totals.planned, unit)}</span>
            </span>
            <span className="block truncate text-2xs text-fg-muted tabular-nums">
              {formatQty(totals.built)} <span className="@max-[125px]:hidden">built</span>
              <span className="@min-[125px]:hidden">of {formatQty(totals.planned)}</span>
              <span className="@max-[125px]:hidden"> · {totals.done} done</span>
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent flush align="start" className="w-auto">
        <DayPopover date={date} tasks={builds} />
      </PopoverContent>
    </Popover>
  );
}

/* --------------------------------------------------------------------------------------------- */
/* Table columns                                                                                 */
/* --------------------------------------------------------------------------------------------- */

function sumQty(tasks: readonly TaskSummary[], pick: (build: BuildBlockDTO) => string): bigint {
  return tasks.reduce((sum, task) => {
    const build = buildOf(task);
    return build ? sum + quantityToScaled(pick(build)) : sum;
  }, BigInt(0));
}

function PlannedEditor({ task, close, seed, actions }: { readonly task: TaskSummary; readonly close: () => void; readonly seed: string | null; readonly actions: BuildActions }) {
  const build = buildOf(task);
  const [value, setValue] = useState(seed ?? (build ? trimQty(build.plannedQty) : ''));
  const commit = () => {
    const read = readQty(value);
    close();
    if (read.ok && read.qty !== null && build && read.qty !== build.plannedQty) void actions.update(task, { plannedQty: read.qty });
  };
  return (
    <input
      autoFocus
      inputMode="decimal"
      aria-label={`Planned for ${task.key}`}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') close();
      }}
      className="h-full w-full bg-panel px-2 text-right text-sm tabular-nums outline-none ring-2 ring-focus ring-inset"
    />
  );
}

function VariantEditor({ task, close, actions }: { readonly task: TaskSummary; readonly close: () => void; readonly actions: BuildActions }) {
  const { activeVariants } = useCurrentProgram();
  const build = buildOf(task);
  return (
    <DropdownMenu open onOpenChange={(open) => !open && close()}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-full w-full items-center px-2 text-left text-sm">
          {build?.variantName ?? 'Pick a variant'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        {activeVariants.map((variant) => (
          <DropdownMenuItem key={variant.id} icon={<VariantDot color={variant.color} />} onSelect={() => variant.id !== build?.variantId && void actions.update(task, { variantId: variant.id })}>
            {variant.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DayEditor({ task, close, actions }: { readonly task: TaskSummary; readonly close: () => void; readonly actions: BuildActions }) {
  const build = buildOf(task);
  return (
    <span className="flex h-full items-center px-1">
      <IsoDatePicker
        value={build?.buildDate ?? null}
        onChange={(date) => {
          close();
          if (date && build && date !== build.buildDate) void actions.update(task, { buildDate: date });
        }}
      />
    </span>
  );
}

function BuiltCellEditor({ task, close }: { readonly task: TaskSummary; readonly close: () => void }) {
  const build = buildOf(task);
  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-full w-full items-center justify-end px-2 text-sm tabular-nums">
          {build ? formatQty(build.builtQty) : ''}
        </button>
      </PopoverTrigger>
      <PopoverContent flush align="end" className="w-auto">
        <BuiltEditor task={task} onDone={close} />
      </PopoverContent>
    </Popover>
  );
}

function useBuildColumns(actions: BuildActions, runName: (runId: string) => string): ColumnDef[] {
  const { unit, moneyHidden, key, variantById } = useCurrentProgram();
  return useMemo(() => {
    const qty = (pick: (build: BuildBlockDTO) => string) =>
      function renderQty(task: TaskSummary) {
        const build = buildOf(task);
        return build ? <span className="tabular-nums">{formatQty(pick(build))}</span> : null;
      };
    const qtyCsv = (pick: (build: BuildBlockDTO) => string) => (task: TaskSummary) => {
      const build = buildOf(task);
      return build ? formatQty(pick(build)).replace(/,/g, '') : '';
    };
    const qtySum = (pick: (build: BuildBlockDTO) => string) => (tasks: readonly TaskSummary[]) => unitLabel(fromScaled(sumQty(tasks, pick), 3), unit);
    const cols: ColumnDef[] = [
      {
        key: 'b:variant',
        label: 'Variant',
        icon: <Shapes aria-hidden />,
        defaultWidth: 160,
        minWidth: 124,
        editor: 'custom',
        defaultVisible: true,
        render: (task) => {
          const build = buildOf(task);
          return build?.variantName ? <VariantChip name={build.variantName} color={build.variantColor} /> : null;
        },
        csv: (task) => buildOf(task)?.variantName ?? '',
        renderEditor: (task, close) => <VariantEditor task={task} close={close} actions={actions} />,
      },
      {
        key: 'b:sku',
        label: 'SKU',
        icon: <Hash aria-hidden />,
        defaultWidth: 130,
        minWidth: 90,
        editor: 'readonly',
        render: (task) => {
          const id = buildOf(task)?.variantId;
          const sku = id ? variantById.get(id)?.sku : null;
          return sku ? <span className="font-key text-xs text-fg-secondary">{sku}</span> : null;
        },
        csv: (task) => {
          const id = buildOf(task)?.variantId;
          return (id ? variantById.get(id)?.sku : null) ?? '';
        },
      },
      {
        key: 'b:day',
        label: 'Day',
        icon: <CalendarDays aria-hidden />,
        defaultWidth: 124,
        minWidth: 108,
        editor: 'custom',
        defaultVisible: true,
        render: (task) => {
          const build = buildOf(task);
          return build ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              {build.locked ? <LockIcon reason="This day is closed." /> : null}
              {dayLabel(build.buildDate)}
            </span>
          ) : null;
        },
        csv: (task) => buildOf(task)?.buildDate ?? '',
        renderEditor: (task, close) => <DayEditor task={task} close={close} actions={actions} />,
      },
      {
        key: 'b:run',
        label: 'Run',
        icon: <Boxes aria-hidden />,
        defaultWidth: 170,
        minWidth: 110,
        editor: 'readonly',
        render: (task) => {
          const build = buildOf(task);
          return build ? <span className="truncate text-fg-secondary">{runName(build.runId)}</span> : null;
        },
        csv: (task) => {
          const build = buildOf(task);
          return build ? runName(build.runId) : '';
        },
      },
      { key: 'b:planned', label: 'Planned', icon: <Hash aria-hidden />, defaultWidth: 108, minWidth: 104, align: 'right', editor: 'custom', defaultVisible: true, render: qty((b) => b.plannedQty), csv: qtyCsv((b) => b.plannedQty), sum: qtySum((b) => b.plannedQty), renderEditor: (task, close, seed) => <PlannedEditor task={task} close={close} seed={seed} actions={actions} /> },
      {
        key: 'b:plannedFrom',
        label: 'Planned from',
        icon: <Boxes aria-hidden />,
        defaultWidth: 140,
        minWidth: 100,
        editor: 'readonly',
        render: (task) => {
          const build = buildOf(task);
          return build ? <span className="truncate text-fg-secondary">{PLANNED_FROM_LABELS[build.plannedFrom] ?? build.plannedFromText}</span> : null;
        },
        csv: (task) => buildOf(task)?.plannedFromText ?? '',
      },
      {
        key: 'b:built',
        label: 'Built',
        icon: <ClipboardPen aria-hidden />,
        defaultWidth: 132,
        minWidth: 116,
        align: 'right',
        editor: 'custom',
        defaultVisible: true,
        render: (task) => {
          const build = buildOf(task);
          return build ? (
            <span className="flex w-full items-center justify-end gap-2" title={qtyOfText(build.builtQty, build.plannedQty, unit)}>
              <span className="tabular-nums">{formatQty(build.builtQty)}</span>
              <ProgressBar value={qtyPercent(build.builtQty, build.plannedQty)} size="sm" tone={qtyTone(build.builtQty, build.plannedQty)} label={qtyOfText(build.builtQty, build.plannedQty, unit)} className="w-10 shrink-0" />
            </span>
          ) : null;
        },
        csv: qtyCsv((b) => b.builtQty),
        sum: qtySum((b) => b.builtQty),
        renderEditor: (task, close) => <BuiltCellEditor task={task} close={close} />,
      },
      { key: 'b:remaining', label: 'Remaining', icon: <Hash aria-hidden />, defaultWidth: 124, minWidth: 120, align: 'right', editor: 'readonly', defaultVisible: true, render: qty((b) => b.remainingQty), csv: qtyCsv((b) => b.remainingQty), sum: qtySum((b) => b.remainingQty) },
      { key: 'b:scrap', label: 'Scrap', icon: <Hash aria-hidden />, defaultWidth: 90, minWidth: 70, align: 'right', editor: 'readonly', render: qty((b) => b.scrapQty), csv: qtyCsv((b) => b.scrapQty), sum: qtySum((b) => b.scrapQty) },
      {
        key: 'b:schedule',
        label: 'Schedule',
        icon: <CalendarDays aria-hidden />,
        defaultWidth: 150,
        minWidth: 100,
        editor: 'readonly',
        render: (task) => {
          const build = buildOf(task);
          return build ? <span className="truncate text-fg-secondary">{build.scheduleId ? runName(build.runId) : 'By hand'}</span> : null;
        },
        csv: (task) => {
          const build = buildOf(task);
          return build?.scheduleId ? runName(build.runId) : 'By hand';
        },
      },
    ];
    if (!moneyHidden) {
      cols.push(
        {
          key: 'b:rate',
          label: 'Rate',
          icon: <Hash aria-hidden />,
          defaultWidth: 96,
          minWidth: 96,
          align: 'right',
          editor: 'readonly',
          render: (task) => {
            const build = buildOf(task);
            return build ? <span className="tabular-nums">{formatUnitPrice(build.currentPrice?.unitPrice ?? null)}</span> : null;
          },
          csv: (task) => buildOf(task)?.currentPrice?.unitPrice ?? '',
        },
        {
          key: 'b:priceFrom',
          label: 'Price from',
          icon: <Hash aria-hidden />,
          defaultWidth: 140,
          minWidth: 132,
          editor: 'readonly',
          render: (task) => {
            const build = buildOf(task);
            return build ? <PriceFromChip source={build.currentPrice?.source ?? 'none'} /> : null;
          },
          csv: (task) => PRICE_SOURCE_LABELS[buildOf(task)?.currentPrice?.source ?? 'none'] ?? '',
        },
        {
          key: 'b:revenue',
          label: 'Revenue',
          icon: <Hash aria-hidden />,
          defaultWidth: 116,
          minWidth: 108,
          align: 'right',
          editor: 'readonly',
          defaultVisible: true,
          render: (task) => {
            const build = buildOf(task);
            return build?.revenueCents && build.revenueCents !== '0' ? <MoneyText cents={build.revenueCents} /> : null;
          },
          csv: (task) => {
            const cents = buildOf(task)?.revenueCents;
            return cents ? (Number(cents) / 100).toFixed(2) : '';
          },
          sum: (tasks) => {
            const total = totalsOf(tasks).revenueCents;
            return total === null ? null : formatCents(total, { cents: true });
          },
        },
        {
          key: 'b:goesTo',
          label: 'Revenue goes to',
          icon: <Hash aria-hidden />,
          defaultWidth: 160,
          minWidth: 110,
          editor: 'readonly',
          render: (task) => {
            const build = buildOf(task);
            return build ? <RevenueGoesToChip posting={build.posting} jobNumber={build.pulseJob?.number} programKey={key} /> : null;
          },
          csv: (task) => buildOf(task)?.posting ?? '',
        },
      );
    }
    return cols;
  }, [actions, key, moneyHidden, runName, unit, variantById]);
}

/* --------------------------------------------------------------------------------------------- */
/* Bulk bar                                                                                      */
/* --------------------------------------------------------------------------------------------- */

function BulkActions({ ids, tasks, clear, actions }: { readonly ids: readonly string[]; readonly tasks: readonly TaskSummary[]; readonly clear: () => void; readonly actions: BuildActions }) {
  const { capabilities, today, activeVariants } = useCurrentProgram();
  const overlays = useProgramOverlays();
  const chosen = tasks.filter((task) => ids.includes(task.id) && buildOf(task));
  if (chosen.length === 0) return null;
  const days = [...new Set(chosen.map((task) => buildOf(task)!.buildDate))];
  const logDay = days.length === 1 && days[0]! <= today ? days[0]! : today;
  const withOutput = chosen.some(hasOutput);
  return (
    <>
      {capabilities.canLog ? <BarButton icon={<ClipboardPen aria-hidden />} label="Log" onClick={() => overlays.openLog({ date: logDay, builds: chosen.map((task) => task.id) })} data-testid="bulk-log" /> : null}
      {capabilities.canPlan ? (
        <>
          <BarButton icon={<CalendarDays aria-hidden />} label="Move" onClick={() => openBuildDialog({ kind: 'day', builds: chosen })} data-testid="bulk-day" />
          <BarButton icon={<Hash aria-hidden />} label="Planned" onClick={() => openBuildDialog({ kind: 'planned', builds: chosen })} data-testid="bulk-planned" />
          {activeVariants.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <BarButton icon={<Shapes aria-hidden />} label="Variant" data-testid="bulk-variant" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" className="max-h-80 w-56 overflow-y-auto">
                {activeVariants.map((variant) => (
                  <DropdownMenuItem
                    key={variant.id}
                    icon={<VariantDot color={variant.color} />}
                    onSelect={async () => {
                      for (const task of chosen) await actions.update(task, { variantId: variant.id });
                      clear();
                    }}
                  >
                    {variant.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <BarButton
            icon={<Ban aria-hidden />}
            label="Cancel"
            danger
            onClick={() => {
              void actions.cancel(chosen.map((task) => task.id));
              clear();
            }}
            data-testid="bulk-cancel"
          />
          {!withOutput ? (
            <BarButton
              icon={<Trash2 aria-hidden />}
              label="Delete"
              danger
              onClick={() => {
                void actions.remove(chosen.map((task) => task.id));
                clear();
              }}
              data-testid="bulk-delete-builds"
            />
          ) : (
            <Tooltip content="Builds with output cannot be deleted. Cancel them instead.">
              <span className="inline-flex">
                <BarButton icon={<Lock aria-hidden />} label="Delete" disabled className="opacity-50" />
              </span>
            </Tooltip>
          )}
        </>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------------------------------------- */
/* The hook                                                                                      */
/* --------------------------------------------------------------------------------------------- */

export interface BuildExtrasInput {
  readonly range: { readonly from: IsoDate; readonly to: IsoDate };
  readonly filters: BuildFilters;
  readonly filterFn: (task: TaskSummary) => boolean;
  readonly extraFilterCount: number;
  readonly tasks: readonly TaskSummary[];
  readonly grouping: string | null;
  readonly onGroupingChange: (value: string | null) => void;
  readonly toolbarLead: ReactNode;
  readonly toolbarTrail: ReactNode;
  readonly renderEmpty: () => ReactNode;
  /** Display > Show, Swimlanes and Order (state lives in the page). */
  readonly show: BuildShow;
  readonly onToggleShow: (key: string) => void;
  readonly lane: string | null;
  readonly onLaneChange: (value: string | null) => void;
  readonly order: string | null;
  readonly onOrderChange: (value: string | null) => void;
}

export function useBuildExtras(input: BuildExtrasInput): CardExtrasValue {
  const { key, unit, today, variants, variantById, capabilities, program } = useCurrentProgram();
  const actions = useBuildActions(key);
  const runs = useProgramRuns(key, input.range);
  const runById = useMemo(() => new Map((runs.data ?? []).map((run) => [run.id, run])), [runs.data]);
  const runName = useMemo(() => (runId: string) => runById.get(runId)?.name ?? (runId.startsWith('run:manual:') ? 'Unscheduled' : 'Scheduled run'), [runById]);
  const columns = useBuildColumns(actions, runName);
  const { range, tasks } = input;

  const groupings = useMemo<ExtraGrouping[]>(() => {
    const runGroup: ExtraGrouping = {
      value: 'run',
      label: 'Run',
      keyOf: runKeyOf,
      order: orderRunKeys,
      info: (groupKey, groupTasks) => {
        if (groupKey === TASKS_GROUP) return { key: groupKey, title: 'Other tasks' };
        const run = runById.get(groupKey) ?? (groupTasks.length ? runFromTasks(groupKey, groupTasks, 'Unscheduled', key) : null);
        const date = run?.date ?? buildOf(groupTasks[0]!)?.buildDate ?? '';
        return {
          key: groupKey,
          title: `${dayLabel(date)} · ${run?.name ?? 'Run'}`,
          icon: run ? <RunRing done={run.done} total={run.builds} size={16} /> : undefined,
          meta: run ? `${qtyOfText(run.builtUnits, run.plannedUnits, unit)} · ${doneOfText(run.done, run.builds, 'done')}` : undefined,
          actions: run ? <RunMenu run={run} /> : undefined,
        };
      },
    };
    const dayGroup: ExtraGrouping = {
      value: 'day',
      label: 'Day',
      keyOf: dayKeyOf,
      order: (list) => [...new Set(list.map(dayKeyOf))].sort().reverse(),
      info: (groupKey, groupTasks) => {
        const totals = totalsOf(groupTasks);
        return { key: groupKey, title: groupKey === 'none' ? 'No day' : dayLabel(groupKey), icon: <RunRing done={totals.done} total={totals.builds} size={16} />, meta: `${qtyOfText(totals.built, totals.planned, unit)} · ${doneOfText(totals.done, totals.builds, 'done')}` };
      },
    };
    const variantGroup: ExtraGrouping = {
      value: 'variant',
      label: 'Variant',
      keyOf: variantKeyOf,
      order: (list) => {
        const present = new Set(list.map(variantKeyOf));
        return [...variants.map((variant) => variant.id).filter((id) => present.has(id)), ...(present.has('none') ? ['none'] : []), ...(present.has(TASKS_GROUP) ? [TASKS_GROUP] : [])];
      },
      info: (groupKey, groupTasks) => {
        const variant = variantById.get(groupKey);
        const totals = totalsOf(groupTasks);
        return { key: groupKey, title: variant?.name ?? (groupKey === TASKS_GROUP ? 'Other tasks' : 'No variant'), icon: variant ? <VariantDot color={variant.color} /> : undefined, meta: `${totals.builds} ${totals.builds === 1 ? 'build' : 'builds'} · ${qtyOfText(totals.built, totals.planned, unit)}` };
      },
    };
    return [runGroup, dayGroup, variantGroup];
  }, [key, runById, unit, variantById, variants]);

  const timelineGroup = useMemo(
    () => ({
      label: 'Variant',
      keyOf: variantKeyOf,
      title: (groupKey: string) => variantById.get(groupKey)?.name ?? (groupKey === TASKS_GROUP ? 'Other tasks' : 'No variant'),
      order: (list: readonly TaskSummary[]) => {
        const present = new Set(list.map(variantKeyOf));
        return [...variants.map((variant) => variant.id).filter((id) => present.has(id)), ...(present.has('none') ? ['none'] : []), ...(present.has(TASKS_GROUP) ? [TASKS_GROUP] : [])];
      },
    }),
    [variantById, variants],
  );

  const { show, onToggleShow, lane, onLaneChange, order, onOrderChange } = input;
  const lockedThrough = program.locks.lockedThrough;
  const refuseDate = useCallback(
    (task: TaskSummary, date: string): string | null => {
      const build = buildOf(task);
      if (!build) return null;
      if (!capabilities.canPlan) return 'Only editors can move builds.';
      if (build.locked) return 'This build is on a closed day. Owners can reopen the month.';
      if (lockedThrough && date <= lockedThrough) return `Days through ${dayLabel(lockedThrough)} are closed.`;
      return null;
    },
    [capabilities.canPlan, lockedThrough],
  );
  const moveToDate = useCallback((task: TaskSummary, date: string) => actions.update(task, { buildDate: date }, `Moved ${task.key} to ${dayLabel(date)}`), [actions]);
  const display = useMemo<ExtraDisplay>(() => {
    const variantRank = (id: string | null) => {
      const index = id ? variants.findIndex((variant) => variant.id === id) : -1;
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    const variantOrder = (list: readonly TaskSummary[]) => {
      const present = new Set(list.map(variantKeyOf));
      return [...variants.map((variant) => variant.id).filter((id) => present.has(id)), ...(present.has('none') ? ['none'] : []), ...(present.has(TASKS_GROUP) ? [TASKS_GROUP] : [])];
    };
    const lanes: ExtraLane[] = [
      {
        value: 'variant',
        label: 'Variant',
        keyOf: variantKeyOf,
        order: variantOrder,
        info: (laneKey) => {
          const variant = variantById.get(laneKey);
          return { key: laneKey, title: variant?.name ?? (laneKey === TASKS_GROUP ? 'Other tasks' : 'No variant'), icon: variant ? <VariantDot color={variant.color} /> : undefined };
        },
        move: (task, laneKey) => {
          const build = buildOf(task);
          if (!build || !capabilities.canPlan || !variantById.has(laneKey) || build.locked) return false;
          void actions.update(task, { variantId: laneKey }, `Moved ${task.key} to ${variantById.get(laneKey)?.name ?? 'the variant'}`);
          return true;
        },
      },
      {
        value: 'day',
        label: 'Day',
        keyOf: dayKeyOf,
        order: (list) => [...new Set(list.map(dayKeyOf))].sort(),
        info: (laneKey) => ({ key: laneKey, title: laneKey === 'none' ? 'No day' : dayLabel(laneKey), icon: <CalendarDays aria-hidden className="size-4 text-icon" /> }),
        move: (task, laneKey) => {
          const build = buildOf(task);
          if (!build || !capabilities.canPlan || laneKey === 'none' || build.locked) return false;
          void actions.update(task, { buildDate: laneKey }, `Moved ${task.key} to ${dayLabel(laneKey)}`);
          return true;
        },
      },
    ];
    const orders: ExtraOrder[] = (Object.keys(BUILD_ORDER_LABELS) as BuildOrderKey[]).map((value) => ({ value, label: BUILD_ORDER_LABELS[value], compare: compareBuilds(value, variantRank) }));
    return {
      toggles: BUILD_SHOW_KEYS.map((showKey) => ({ label: BUILD_SHOW_LABELS[showKey], checked: show[showKey], onChange: () => onToggleShow(showKey), testId: `toggle-show-${showKey}` })),
      lanes,
      sharedLanes: ['assignee'],
      lane,
      onLaneChange,
      orders,
      order,
      onOrderChange,
      collapseEmptyColumns: true,
    };
  }, [actions, capabilities.canPlan, lane, onLaneChange, onOrderChange, onToggleShow, order, show, variantById, variants]);

  return useMemo<CardExtrasValue>(
    () => ({
      display,
      toolbarLead: input.toolbarLead,
      toolbarTrail: input.toolbarTrail,
      filter: input.filterFn,
      extraFilterCount: input.extraFilterCount,
      renderCardFooter: (task) => <BuildCardFacts task={task} show={show} />,
      renderRowCells: (task) => <BuildRowCells task={task} show={show} />,
      rowCellsHeader: <RowCellsHeader show={show} />,
      renderMenuItems: (task, parts) => (buildOf(task) ? <BuildMenuItems task={task} kind={parts.kind} actions={actions} /> : null),
      renderMenuDanger: (task, parts) => (buildOf(task) ? <BuildDangerItems task={task} kind={parts.kind} actions={actions} /> : null),
      hideTaskMenuItems: (task) => (buildOf(task) ? ['duplicate', 'move', 'delete', 'due'] : []),
      extraColumns: columns,
      defaultHiddenColumns: ['estimate', 'estimateTime', 'links', 'customer', 'priority', 'labels', 'startDate', 'dueDate', 'cycle', 'section'],
      groupings,
      grouping: input.grouping,
      onGroupingChange: input.onGroupingChange,
      foldBefore: (task) => foldsOnBoard(task, range, today),
      renderDaySummary: (date, dayTasks) => <DaySummary date={date} tasks={dayTasks} />,
      refuseDate,
      moveToDate,
      calendarChipLabel: (task) => {
        const build = buildOf(task);
        return build ? `${formatQty(build.builtQty)} of ${formatQty(build.plannedQty)}` : task.title;
      },
      timelineGroup,
      renderBulkActions: (ids, clear) => <BulkActions ids={ids} tasks={tasks} clear={clear} actions={actions} />,
      renderEmpty: input.renderEmpty,
      noun: { singular: 'build', plural: 'builds' },
      hideCreate: true,
    }),
    [actions, columns, display, groupings, input, moveToDate, range, refuseDate, show, tasks, timelineGroup, today],
  );
}
