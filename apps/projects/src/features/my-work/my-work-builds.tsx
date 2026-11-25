'use client';
/**
 * The "Builds" group of My Work (docs/programs/SPEC.md 5.17): your open builds for today and
 * overdue ones, grouped by run, each with its variant, qty progress and a Log button that opens
 * the log dialog filtered to that build. Read per running program through the builds API
 * (assignee = you), so it stays live after logging. Focus mode never includes builds.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { ChevronDown, ClipboardPen } from 'lucide-react';
import { addDays } from '@kitstak/programs-engine';
import { Skeleton, cn } from '@/components/ui';
import { StatusIcon } from '@/components/pm';
import { apiGet, apiPath } from '@/lib/api-client';
import { usePrograms } from '@/lib/hooks/use-programs';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import type { BuildsPageDTO, IsoDate, UnitLabel } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import { ProgramChip, VariantChip } from '@/features/programs/kit/chips';
import { QtyProgress } from '@/features/programs/kit/numbers';
import { dayLabel } from '@/features/programs/kit/format';
import { logHref } from '@/features/programs/overlays/overlay-params';
import { groupBuildsByRun } from './my-work-model';

export function MyWorkBuilds({ userId, collapsed, onToggle }: { readonly userId: string; readonly collapsed: boolean; readonly onToggle: () => void }) {
  const pathname = usePathname() ?? '/my-work';
  const params = useSearchParams();
  const { openTask } = useTaskDrawer();
  const programs = usePrograms({}, { staleTime: 60_000 });
  const running = useMemo(() => (programs.data ?? []).filter((program) => !program.archivedAt && program.status === 'active'), [programs.data]);
  const today = running[0]?.today.date ?? new Date().toLocaleDateString('en-CA');
  const results = useQueries({
    queries: running.map((program) => ({
      queryKey: [...qk.projectTasks(program.key), 'mine', userId, today],
      queryFn: () => apiGet<BuildsPageDTO>(apiPath(`programs/${encodeURIComponent(program.key)}/builds`, { from: addDays(today, -14), to: today, assignee: userId, limit: 200 })),
      staleTime: 15_000,
    })),
  });
  const units = useMemo(() => new Map<string, UnitLabel>(running.map((program) => [program.key, program.unit])), [running]);
  const names = useMemo(() => new Map(running.map((program) => [program.key, program.name])), [running]);
  const builds = useMemo(() => results.flatMap((result) => (result.data?.items ?? []) as unknown as TaskSummary[]), [results]);
  const groups = useMemo(() => groupBuildsByRun(builds, today), [builds, today]);
  const loading = programs.isPending || results.some((result) => result.isPending);
  if (!loading && groups.length === 0) return null;
  const count = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const current = new URLSearchParams(params?.toString() ?? '');

  return (
    <section aria-labelledby="group-builds" data-testid="my-work-group-builds">
      <h2 id="group-builds" className="mb-1 flex items-center gap-2 px-1">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="inline-flex items-center gap-1.5 rounded-sm text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
          Builds
          <span className="font-normal tabular-nums">{loading ? '' : count}</span>
        </button>
        <span className="hidden text-xs text-fg-disabled sm:inline">Yours for today and earlier, by run</span>
      </h2>
      {collapsed ? null : loading ? (
        <Skeleton height={88} rounded="lg" />
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => {
            const unit = units.get(group.programKey) ?? { singular: 'unit', plural: 'units' };
            return (
              <ul key={group.key} className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs" aria-label={`${group.programKey} ${dayLabel(group.date)}`}>
                <li className="flex items-center gap-2 border-b border-border-subtle bg-sunken/40 px-4 py-2">
                  <ProgramChip program={{ key: group.programKey, name: names.get(group.programKey) ?? group.programKey }} link={false} size="sm" />
                  <span className={cn('text-xs', group.overdue ? 'font-medium text-danger-text' : 'text-fg-secondary')}>
                    {group.overdue ? `Overdue · ${dayLabel(group.date)}` : `Today · ${dayLabel(group.date)}`}
                  </span>
                </li>
                {group.tasks.map((task) => {
                  const build = task.build!;
                  return (
                    <li key={task.id} className="flex min-h-11 items-center gap-3 border-b border-border-subtle px-4 py-1.5 last:border-b-0 max-sm:flex-wrap" data-testid="my-work-build">
                      <button type="button" onClick={() => openTask(task.key)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-focus">
                        <StatusIcon category={task.statusCategory} size={16} />
                        <span className="shrink-0 font-key text-xs text-fg-muted">{task.key}</span>
                        {build.variantName ? <VariantChip name={build.variantName} color={build.variantColor} /> : <span className="truncate text-sm text-fg">{task.title}</span>}
                      </button>
                      <QtyProgress built={build.builtQty} planned={build.plannedQty} unit={unit} />
                      <Link
                        href={logHref(pathname, current, { date: build.buildDate as IsoDate, builds: [task.id], programKey: group.programKey })}
                        scroll={false}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border-input px-2 text-xs font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
                        data-testid="my-work-log"
                      >
                        <ClipboardPen aria-hidden className="size-3.5" />
                        Log
                      </Link>
                    </li>
                  );
                })}
              </ul>
            );
          })}
        </div>
      )}
    </section>
  );
}
