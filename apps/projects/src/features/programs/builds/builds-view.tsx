'use client';
/**
 * The Builds tab (docs/programs/SPEC.md 5.7): Runs (default), Board, List, Table, Calendar and
 * Timeline over one date window. The shared project views render builds through two seams:
 * `TaskSourceProvider` (the builds of the window) and `CardExtrasProvider` (build facts, run
 * grouping, the Done fold, build menus and the bulk bar). The range bar under the tabs (L3)
 * and the toolbar's range control write the same `range` param.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarRange, Shapes } from 'lucide-react';
import { addDays, endOfMonth, startOfMonth } from '@kitstak/programs-engine';
import { Button, EmptyState } from '@/components/ui';
import { BoardView } from '@/features/board';
import { CalendarView } from '@/features/calendar';
import { ListView } from '@/features/list';
import { TableView } from '@/features/table';
import { TimelineView } from '@/features/timeline';
import { CardExtrasProvider } from '@/features/views/card-extras';
import { TaskSourceProvider } from '@/features/views/task-source';
import { routes } from '@/lib/routes';
import type { BuildView } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProgram } from '../program-context';
import { rangeLabel } from '../kit/format';
import { useBuildRange } from '../frame/range-bar';
import { presetRange } from '../frame/range';
import { useProgramOverlays } from '../overlays/overlay-params';
import { setPageTaskList } from '@/features/task/task-nav';
import { BUILD_FILTER_PARAM, DEFAULT_BUILD_FILTERS, activeBuildFilterCount, buildOf, buildShowFrom, formatBuildFilters, matchesBuildFilters, parseBuildFilters, type BuildFilters } from './builds-model';
import { usePageFilter, useQuickFilterState, type FilterStateApi } from '@/features/views/view-toolbar';
import { countActiveFilters, matchesQuick } from '@/features/views/view-state';
import { useStoredSet } from '@/features/views/use-stored-set';
import { BuildDialogsHost } from './build-dialogs';
import { useBuildExtras } from './build-extras';
import { BuildViewToggle, BuildsMoreMenu, RangeControl, useBuildFilterCategories } from './builds-toolbar';
import { RunsView } from './runs-view';
import { useIsNarrow } from '@/features/timeline/use-view-prefs';
import { useBuildTasks } from './use-build-tasks';

const NO_TASKS: readonly TaskSummary[] = [];
const GROUP_PARAM = 'bgroup';
const LANE_PARAM = 'blane';
const ORDER_PARAM = 'border';

function BuildsEmpty({ from, to, onChangeDates }: { readonly from: string; readonly to: string; readonly onChangeDates: () => void }) {
  const { key, activeVariants, capabilities } = useCurrentProgram();
  const overlays = useProgramOverlays();
  if (activeVariants.length === 0) {
    return (
      <EmptyState
        illustration="board"
        title="Add variants before you plan builds"
        description="Variants are the kits this program makes, like Small Brown. Each build makes one variant."
        actions={
          <Link href={routes.programTab(key, 'variants')} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-focus">
            <Shapes aria-hidden className="size-4" />
            Add variants
          </Link>
        }
        className="py-16"
      />
    );
  }
  return (
    <EmptyState
      illustration="board"
      title={`No builds from ${rangeLabel(from, to)}`}
      description="Plan builds for these days, or look at other dates."
      actions={
        <>
          {capabilities.canPlan ? (
            <Button leadingIcon={<CalendarRange aria-hidden />} onClick={() => overlays.openPlanner('week', from)}>
              Plan builds
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onChangeDates}>
            Change dates
          </Button>
        </>
      }
      className="py-16"
    />
  );
}

/** The Runs toolbar: the same row as the other views (toggle, range, Filter, More). */
function RunsToolbar({ state, tasks, lead, trail }: { readonly state: FilterStateApi; readonly tasks: readonly TaskSummary[]; readonly lead: React.ReactNode; readonly trail: React.ReactNode }) {
  const narrow = useIsNarrow();
  const filter = usePageFilter(state, tasks, { compact: narrow });
  return (
    <div className="shrink-0 border-b border-border-subtle bg-panel">
      <div role="toolbar" aria-label="Builds tools" className="flex h-12 items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
        {lead}
        <span aria-hidden className="mx-0.5 h-5 w-px bg-border-subtle" />
        {filter.button}
        <span aria-hidden className="min-w-2 flex-1 !shrink" />
        {trail}
      </div>
      {filter.chips}
    </div>
  );
}

export function BuildsView({ view }: { readonly view: BuildView }) {
  const { key, today } = useCurrentProgram();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const { range, setRange } = useBuildRange(view);
  const filters = useMemo(() => parseBuildFilters(params?.get(BUILD_FILTER_PARAM)), [params]);
  const setParam = useCallback(
    (name: string, value: string | null) => {
      // The live URL: the shared filters write it with history calls a moment earlier.
      const search = new URLSearchParams(globalThis.location.search);
      if (value) search.set(name, value);
      else search.delete(name);
      const query = search.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );
  const setFilters = useCallback((next: BuildFilters) => setParam(BUILD_FILTER_PARAM, formatBuildFilters(next) || null), [setParam]);
  const groupParam = params?.get(GROUP_PARAM);
  const grouping = groupParam === 'field' ? null : groupParam ?? 'run';
  const onGroupingChange = useCallback((value: string | null) => setParam(GROUP_PARAM, value === 'run' ? null : value ?? 'field'), [setParam]);
  const [rangeNudge, setRangeNudge] = useState(0);
  const showFlipped = useStoredSet(`ks.programs.builds.show.${key}`);
  const show = useMemo(() => buildShowFrom(showFlipped.values), [showFlipped.values]);
  const lane = params?.get(LANE_PARAM) ?? null;
  const order = params?.get(ORDER_PARAM) ?? null;
  const onLaneChange = useCallback((value: string | null) => setParam(LANE_PARAM, value), [setParam]);
  const onOrderChange = useCallback((value: string | null) => setParam(ORDER_PARAM, value), [setParam]);

  // The board also reads the two weeks before the range: open builds carried over from earlier
  // days stay on the board, and done ones fold into "Done earlier".
  // The calendar shows whole months, so it reads the months the range touches.
  const window = useMemo(() => {
    if (view === 'board') return { from: addDays(range.from, -14), to: range.to };
    if (view === 'calendar') return { from: addDays(startOfMonth(range.from), -7), to: addDays(endOfMonth(range.to), 7) };
    return { from: range.from, to: range.to };
  }, [range.from, range.to, view]);
  const { source } = useBuildTasks(key, window, { workKind: filters.workKind });
  const tasks: readonly TaskSummary[] = source.tasks ?? NO_TASKS;
  // Board, List and Table apply the shared filters (Search, Status, Assignee...) through their own
  // view state; Runs, Calendar and Timeline get them here, from the same URL params.
  const quickState = useQuickFilterState();
  const ownsQuick = view === 'runs' || view === 'calendar' || view === 'timeline';
  const { quick, me } = quickState;
  const filterFn = useCallback((task: TaskSummary) => matchesBuildFilters(task, filters) && (!ownsQuick || matchesQuick(task, quick, me)), [filters, me, ownsQuick, quick]);
  const filterCategories = useBuildFilterCategories(filters, setFilters, tasks);
  // The drawer's previous and next walk the builds of this range and these filters.
  const { variants } = useCurrentProgram();
  const navKeys = useMemo(() => {
    const rank = new Map(variants.map((variant, index) => [variant.id, index]));
    const numberOf = (task: TaskSummary) => Number(task.key.split('-').at(-1)) || 0;
    const dateOf = (task: TaskSummary) => buildOf(task)?.buildDate ?? task.dueDate ?? '';
    return tasks
      .filter((task) => filterFn(task) && (!buildOf(task) || (buildOf(task)!.buildDate >= range.from && buildOf(task)!.buildDate <= range.to)))
      .sort((a, b) => (view === 'runs' ? dateOf(b).localeCompare(dateOf(a)) : dateOf(a).localeCompare(dateOf(b))) || (rank.get(buildOf(a)?.variantId ?? '') ?? 999) - (rank.get(buildOf(b)?.variantId ?? '') ?? 999) || numberOf(a) - numberOf(b))
      .map((task) => task.key);
  }, [filterFn, range.from, range.to, tasks, variants, view]);
  useEffect(() => {
    setPageTaskList(navKeys);
    return () => setPageTaskList(null);
  }, [navKeys]);
  const clearExtraFilters = useCallback(() => setFilters(DEFAULT_BUILD_FILTERS), [setFilters]);

  const toolbarLead = (
    <span className="flex shrink-0 items-center gap-1.5">
      <BuildViewToggle view={view} />
      {/* The calendar moves by its own month and week arrows; the range follows the grid. */}
      {view === 'calendar' ? null : <RangeControl key={rangeNudge} range={range} onChange={setRange} />}
    </span>
  );
  const toolbarTrail = <BuildsMoreMenu range={range} tasks={tasks} />;
  const renderEmpty = useCallback(() => <BuildsEmpty from={range.from} to={range.to} onChangeDates={() => setRangeNudge((n) => n + 1)} />, [range.from, range.to]);

  const onCalendarSpan = useCallback(
    (from: string, to: string) => {
      if (from === range.from && to === range.to) return;
      const month = presetRange('this-month', today);
      const week = presetRange('this-week', today);
      const preset = from === month.from && to === month.to ? 'this-month' : from === week.from && to === week.to ? 'this-week' : null;
      setRange({ from, to, preset });
    },
    [range.from, range.to, setRange, today],
  );

  const buildExtras = useBuildExtras({
    range,
    filters,
    filterFn,
    extraFilterCount: activeBuildFilterCount(filters) + (ownsQuick ? countActiveFilters(quick) : 0),
    filterCategories,
    clearExtraFilters,
    tasks,
    grouping,
    onGroupingChange,
    toolbarLead,
    toolbarTrail,
    renderEmpty,
    show,
    onToggleShow: showFlipped.toggle,
    lane,
    onLaneChange,
    order,
    onOrderChange,
  });
  const extras = useMemo(() => (view === 'calendar' ? { ...buildExtras, calendarRange: { from: range.from, onVisibleChange: onCalendarSpan } } : buildExtras), [buildExtras, onCalendarSpan, range.from, view]);

  const body =
    view === 'runs' ? (
      <RunsView
        tasks={tasks}
        range={range}
        isLoading={source.isLoading}
        toolbar={<RunsToolbar state={quickState} tasks={tasks} lead={toolbarLead} trail={toolbarTrail} />}
      />
    ) : view === 'board' ? (
      <BoardView />
    ) : view === 'list' ? (
      <ListView />
    ) : view === 'table' ? (
      <TableView />
    ) : view === 'calendar' ? (
      <CalendarView />
    ) : (
      <TimelineView />
    );

  return (
    <TaskSourceProvider source={source}>
      <CardExtrasProvider value={extras}>
        <div className="flex h-full min-h-0 flex-col" data-testid="builds-view" data-view={view}>
          {body}
        </div>
        <BuildDialogsHost />
      </CardExtrasProvider>
    </TaskSourceProvider>
  );
}
