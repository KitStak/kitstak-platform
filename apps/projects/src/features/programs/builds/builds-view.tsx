'use client';
/**
 * The Builds tab (docs/programs/SPEC.md 5.7): Runs (default), Board, List, Table, Calendar and
 * Timeline over one date window. The shared project views render builds through two seams:
 * `TaskSourceProvider` (the builds of the window) and `CardExtrasProvider` (build facts, run
 * grouping, the Done fold, build menus and the bulk bar). The range bar under the tabs (L3)
 * and the toolbar's range control write the same `range` param.
 */
import { useCallback, useMemo, useState } from 'react';
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
import { useProgramOverlays } from '../overlays/overlay-params';
import { BUILD_FILTER_PARAM, activeBuildFilterCount, buildShowFrom, formatBuildFilters, matchesBuildFilters, parseBuildFilters, type BuildFilters } from './builds-model';
import { useStoredSet } from '@/features/views/use-stored-set';
import { BuildDialogsHost } from './build-dialogs';
import { useBuildExtras } from './build-extras';
import { BuildViewToggle, BuildsFilterButton, BuildsMoreMenu, RangeControl } from './builds-toolbar';
import { RunsView } from './runs-view';
import { useBuildTasks } from './use-build-tasks';

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

export function BuildsView({ view }: { readonly view: BuildView }) {
  const { key } = useCurrentProgram();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const { range, setRange } = useBuildRange(view);
  const filters = useMemo(() => parseBuildFilters(params?.get(BUILD_FILTER_PARAM)), [params]);
  const setParam = useCallback(
    (name: string, value: string | null) => {
      const search = new URLSearchParams(params?.toString() ?? '');
      if (value) search.set(name, value);
      else search.delete(name);
      const query = search.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
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
  const tasks: readonly TaskSummary[] = source.tasks ?? [];
  const filterFn = useCallback((task: TaskSummary) => matchesBuildFilters(task, filters), [filters]);

  const toolbarLead = (
    <span className="flex shrink-0 items-center gap-1.5">
      <BuildViewToggle view={view} />
      <RangeControl key={rangeNudge} range={range} onChange={setRange} />
    </span>
  );
  const toolbarTrail = (
    <span className="flex shrink-0 items-center gap-1.5">
      <BuildsFilterButton filters={filters} onChange={setFilters} tasks={tasks} />
      <BuildsMoreMenu range={range} tasks={tasks} />
    </span>
  );
  const renderEmpty = useCallback(() => <BuildsEmpty from={range.from} to={range.to} onChangeDates={() => setRangeNudge((n) => n + 1)} />, [range.from, range.to]);

  const extras = useBuildExtras({
    range,
    filters,
    filterFn,
    extraFilterCount: activeBuildFilterCount(filters),
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

  const body =
    view === 'runs' ? (
      <RunsView
        tasks={tasks}
        range={range}
        isLoading={source.isLoading}
        toolbar={
          <div role="toolbar" aria-label="Builds tools" className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-panel px-4 sm:px-6">
            {toolbarLead}
            <span className="min-w-0 flex-1" />
            {toolbarTrail}
          </div>
        }
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
