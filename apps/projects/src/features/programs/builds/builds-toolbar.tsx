'use client';
/**
 * Builds toolbar parts (docs/programs/SPEC.md 5.7): the view toggle (also routes), the date range
 * control (presets and a custom range, written to the `range` param), the builds Filter (Variant,
 * Short, Unplanned, Work type; Search, Status, Assignee, Labels and Mine sit in the shared filter
 * bar beside it) and the More menu (Import output, Import plan, Export CSV, Print build tickets).
 */
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, CalendarRange, Check, ChevronDown, Download, FileUp, GanttChartSquare, KanbanSquare, List, MoreHorizontal, Printer, Rows3, Shapes, Table2, Upload } from 'lucide-react';
import { addDays, daysBetween } from '@kitstak/programs-engine';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RangeCalendar,
  Switch,
  ToggleGroup,
  type DateRange,
} from '@/components/ui';
import { routes, BUILD_VIEWS } from '@/lib/routes';
import type { BuildView, IsoDate } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import { OptionList } from '@/features/views/option-list';
import { ToolbarPopover } from '@/features/views/toolbar-button';
import type { WorkKind } from '@/features/views/task-source';
import { useCurrentProgram } from '../program-context';
import { VariantDot } from '../kit/chips';
import { RANGE_PRESETS, RANGE_PRESET_LABELS, MAX_RANGE_DAYS, rangeButtonLabel, type BuildRange } from '../frame/range';
import { useProgramOverlays } from '../overlays/overlay-params';
import { activeBuildFilterCount, buildOf, toCsv, type BuildFilters } from './builds-model';
import { ticketsHref } from './run-menu';

const VIEW_META: Readonly<Record<BuildView, { label: string; icon: React.ReactNode }>> = {
  runs: { label: 'Runs', icon: <Rows3 aria-hidden /> },
  board: { label: 'Board', icon: <KanbanSquare aria-hidden /> },
  list: { label: 'List', icon: <List aria-hidden /> },
  table: { label: 'Table', icon: <Table2 aria-hidden /> },
  calendar: { label: 'Calendar', icon: <CalendarDays aria-hidden /> },
  timeline: { label: 'Timeline', icon: <GanttChartSquare aria-hidden /> },
};

export function BuildViewToggle({ view }: { readonly view: BuildView }) {
  const { key } = useCurrentProgram();
  const router = useRouter();
  const params = useSearchParams();
  const go = (next: BuildView) => {
    const search = new URLSearchParams();
    for (const name of ['range', 'bf', 'border']) {
      const value = params?.get(name);
      if (value) search.set(name, value);
    }
    // Board defaults to Today; carrying a long range there would hide the fold rule's point.
    const query = search.toString();
    router.push(`${routes.programBuilds(key, next)}${query ? `?${query}` : ''}`, { scroll: false });
  };
  return (
    <ToggleGroup<BuildView>
      size="sm"
      label="Builds view"
      value={view}
      onValueChange={go}
      options={BUILD_VIEWS.map((value) => ({ value, label: VIEW_META[value].label, icon: VIEW_META[value].icon, iconOnly: true }))}
      className="shrink-0"
    />
  );
}

function toIso(date: Date | undefined): IsoDate | null {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function RangeControl({ range, onChange }: { readonly range: BuildRange; readonly onChange: (range: BuildRange) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>({ from: toDate(range.from), to: toDate(range.to) });
  const draftFrom = toIso(draft?.from);
  const draftTo = toIso(draft?.to ?? draft?.from);
  const tooLong = Boolean(draftFrom && draftTo && daysBetween(draftFrom, draftTo) + 1 > MAX_RANGE_DAYS);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCustom(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" leadingIcon={<CalendarRange aria-hidden />} trailingIcon={<ChevronDown aria-hidden />} className="shrink-0" data-testid="range-control">
          <span className="max-sm:sr-only">{rangeButtonLabel(range)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={custom ? 'w-auto' : 'w-56'} flush>
        {custom ? (
          <div className="p-3">
            <RangeCalendar selected={draft} onSelect={setDraft} numberOfMonths={2} />
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
              <span className="text-xs text-fg-muted">{tooLong ? `Pick ${MAX_RANGE_DAYS} days or fewer.` : 'Pick a start and an end day.'}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setCustom(false)}>
                  Back
                </Button>
                <Button
                  size="sm"
                  disabled={!draftFrom || !draftTo || tooLong}
                  onClick={() => {
                    if (!draftFrom || !draftTo) return;
                    onChange({ from: draftFrom, to: draftTo, preset: null });
                    setOpen(false);
                    setCustom(false);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <ul className="py-1" role="listbox" aria-label="Date range">
            {RANGE_PRESETS.map((preset) => (
              <li key={preset}>
                <button
                  type="button"
                  role="option"
                  aria-selected={range.preset === preset}
                  onClick={() => {
                    onChange({ from: range.from, to: range.to, preset });
                    setOpen(false);
                  }}
                  className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-fg hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                >
                  <span className="flex-1">{RANGE_PRESET_LABELS[preset]}</span>
                  {range.preset === preset ? <Check aria-hidden className="size-4 text-primary-text" /> : null}
                </button>
              </li>
            ))}
            <li className="mt-1 border-t border-border-subtle pt-1">
              <button
                type="button"
                onClick={() => {
                  setDraft({ from: toDate(range.from), to: toDate(range.to) });
                  setCustom(true);
                }}
                className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-fg hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
              >
                <span className="flex-1">Custom range</span>
                {range.preset === null ? <Check aria-hidden className="size-4 text-primary-text" /> : null}
              </button>
            </li>
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

const WORK_KINDS: readonly { value: WorkKind; label: string }[] = [
  { value: 'build', label: 'Builds' },
  { value: 'task', label: 'Tasks' },
  { value: 'both', label: 'Both' },
];

export function BuildsFilterButton({ filters, onChange, tasks }: { readonly filters: BuildFilters; readonly onChange: (filters: BuildFilters) => void; readonly tasks: readonly TaskSummary[] }) {
  const { variants } = useCurrentProgram();
  const count = activeBuildFilterCount(filters);
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const id = buildOf(task)?.variantId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return (
    <ToolbarPopover icon={<Shapes aria-hidden />} label={count ? `Build filters, ${count} on` : 'Build filters'} text="Builds" active={count > 0} badge={count || undefined} width={300} testId="filter-builds">
      <div className="flex flex-col">
        <p className="px-3 pt-3 pb-1 text-2xs font-semibold tracking-wide text-fg-muted uppercase">Variant</p>
        <OptionList
          multiple
          searchable={variants.length > 6}
          placeholder="Find a variant"
          options={variants.filter((variant) => variant.status === 'active' || counts.has(variant.id)).map((variant) => ({ value: variant.id, label: variant.name, icon: <VariantDot color={variant.color} />, hint: counts.get(variant.id), keywords: `${variant.key} ${variant.sku ?? ''}` }))}
          selected={filters.variants}
          onToggle={(value) => onChange({ ...filters, variants: filters.variants.includes(value) ? filters.variants.filter((entry) => entry !== value) : [...filters.variants, value] })}
          className="max-h-56"
        />
        <div className="flex flex-col gap-2.5 border-t border-border-subtle px-3 py-3">
          <label className="flex items-center justify-between gap-3 text-sm text-fg">
            <span>
              Short
              <span className="block text-xs text-fg-muted">Closed below plan</span>
            </span>
            <Switch checked={filters.short} onCheckedChange={(short) => onChange({ ...filters, short })} aria-label="Only builds closed short" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm text-fg">
            <span>
              Unplanned
              <span className="block text-xs text-fg-muted">Made while logging output</span>
            </span>
            <Switch checked={filters.unplanned} onCheckedChange={(unplanned) => onChange({ ...filters, unplanned })} aria-label="Only unplanned builds" />
          </label>
          <div className="flex items-center justify-between gap-3 text-sm text-fg">
            <span>Work type</span>
            <ToggleGroup<WorkKind> size="sm" label="Work type" value={filters.workKind} onValueChange={(workKind) => onChange({ ...filters, workKind })} options={WORK_KINDS} />
          </div>
        </div>
        {count ? (
          <div className="border-t border-border-subtle p-1.5">
            <Button variant="ghost" size="xs" fullWidth onClick={() => onChange({ variants: [], short: false, unplanned: false, workKind: 'build' })}>
              Clear build filters
            </Button>
          </div>
        ) : null}
      </div>
    </ToolbarPopover>
  );
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BuildsMoreMenu({ range, tasks }: { readonly range: BuildRange; readonly tasks: readonly TaskSummary[] }) {
  const { key, capabilities, moneyHidden, statusById } = useCurrentProgram();
  const overlays = useProgramOverlays();
  const exportCsv = () => {
    const header = ['Build', 'Title', 'Variant', 'Day', 'Status', 'Planned', 'Built', 'Remaining', 'Scrap', ...(moneyHidden ? [] : ['Rate', 'Price from', 'Revenue'])];
    const rows = tasks
      .filter((task) => buildOf(task))
      .map((task) => {
        const build = buildOf(task)!;
        const cents = build.revenueCents;
        return [
          task.key,
          task.title,
          build.variantName ?? '',
          build.buildDate,
          statusById.get(task.statusId)?.name ?? '',
          build.plannedQty,
          build.builtQty,
          build.remainingQty,
          build.scrapQty,
          ...(moneyHidden ? [] : [build.currentPrice?.unitPrice ?? '', build.currentPrice?.source ?? 'none', cents ? `${cents.slice(0, -2) || '0'}.${cents.slice(-2).padStart(2, '0')}` : '']),
        ];
      });
    download(`${key}-builds-${range.from}-to-${range.to}.csv`, toCsv([header, ...rows]));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" label="More build actions" icon={<MoreHorizontal aria-hidden />} data-testid="builds-more" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {capabilities.canLog || capabilities.canPlan ? <DropdownMenuLabel>Bring in</DropdownMenuLabel> : null}
        {capabilities.canLog ? (
          <DropdownMenuItem icon={<Upload aria-hidden />} description="CSV with date, SKU or variant, qty" onSelect={() => overlays.openImport('output')}>
            Import output
          </DropdownMenuItem>
        ) : null}
        {capabilities.canPlan ? (
          <DropdownMenuItem icon={<FileUp aria-hidden />} description="Makes planned builds from a CSV" onSelect={() => overlays.openImport('plan')}>
            Import plan
          </DropdownMenuItem>
        ) : null}
        {capabilities.canLog || capabilities.canPlan ? <DropdownMenuSeparator /> : null}
        <DropdownMenuLabel>Share</DropdownMenuLabel>
        <DropdownMenuItem icon={<Download aria-hidden />} onSelect={exportCsv} disabled={tasks.length === 0}>
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Printer aria-hidden />} description="One ticket per build in the range" onSelect={() => window.open(ticketsHref(key, { from: range.from, to: range.to }), '_blank', 'noopener')}>
          Print build tickets
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Download aria-hidden />} description="Production report for the week" onSelect={() => overlays.openReport(`week:${addDays(range.from, 0)}`)}>
          Share report
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
