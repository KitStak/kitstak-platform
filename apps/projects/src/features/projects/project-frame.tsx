'use client';
/** Project header (icon, name, health, star, members, share) and the view tab strip. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, GanttChart, Inbox, KanbanSquare, LayoutDashboard, List, Plus, Repeat, Settings2, Star, Table2, Users, Activity, Paperclip } from 'lucide-react';
import { AvatarGroup, Button, CountBadge, IconButton, ProgressBar, cn, toast } from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { cycleDaysLeft } from '@/lib/cycle-math';
import { formatRange, todayIso } from '@/lib/dates';
import { useCycles, useTriage } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { PROJECT_TABS, routes, type ProjectTab } from '@/lib/routes';
import { starProjectAction } from '@/server/actions/projects';
import { useShellStore } from '@/features/shell/store';
import { ProjectHealthBadge } from './health';
import { useCurrentProject } from './project-context';

const TAB_META: Readonly<Record<ProjectTab | 'cycles' | 'triage', { label: string; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }>> = {
  overview: { label: 'Overview', icon: LayoutDashboard },
  board: { label: 'Board', icon: KanbanSquare },
  list: { label: 'List', icon: List },
  table: { label: 'Table', icon: Table2 },
  timeline: { label: 'Timeline', icon: GanttChart },
  calendar: { label: 'Calendar', icon: CalendarDays },
  workload: { label: 'Workload', icon: Users },
  cycles: { label: 'Cycles', icon: Repeat },
  triage: { label: 'Triage', icon: Inbox },
  files: { label: 'Files', icon: Paperclip },
  activity: { label: 'Activity', icon: Activity },
  settings: { label: 'Settings', icon: Settings2 },
};

/** Planning pages shown as tabs next to the views (not saved-view types). */
type PlanningTab = 'cycles' | 'triage';
type FrameTab = ProjectTab | PlanningTab;

function frameSegment(pathname: string, key: string): string {
  const base = routes.project(key);
  if (pathname === base) return '';
  return pathname.slice(base.length + 1).split('/')[0] ?? '';
}

function activeTab(pathname: string, key: string): FrameTab | null {
  const segment = frameSegment(pathname, key);
  if (segment === '') return 'overview';
  if (segment === 'cycles' || segment === 'triage') return segment;
  return (PROJECT_TABS as readonly string[]).includes(segment) ? (segment as ProjectTab) : null;
}

/** Slim strip over Board and List: the current cycle at a glance. */
function CycleStrip({ projectKey }: { readonly projectKey: string }) {
  const cycles = useCycles(projectKey, { staleTime: 30_000 });
  const current = cycles.data?.cycles.find((c) => c.id === cycles.data?.currentId);
  if (!current) return null;
  const name = current.name?.trim() || `Cycle ${current.number}`;
  const percent = current.taskCount ? Math.round((current.doneCount / current.taskCount) * 100) : 0;
  const left = cycleDaysLeft(current.endDate, todayIso());
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle bg-sunken/50 px-6 py-1.5 text-xs text-fg-secondary" data-testid="cycle-strip">
      <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
        <Repeat aria-hidden className="size-3.5 text-primary-text" />
        {name}
      </span>
      <span>{formatRange(current.startDate, current.endDate)}</span>
      <span>{left === 1 ? 'Last day' : `${left} days left`}</span>
      <span className="inline-flex items-center gap-2">
        <ProgressBar value={percent} size="sm" label={`${name} progress`} tone={percent >= 100 ? 'success' : 'primary'} className="w-24" />
        <span className="tabular-nums">
          {current.doneCount} of {current.taskCount} done
        </span>
      </span>
      {current.goal ? <span className="hidden min-w-0 max-w-md truncate text-fg-muted lg:inline">Goal: {current.goal}</span> : null}
      <Link href={routes.projectCycles(projectKey, current.id)} className="ml-auto inline-flex items-center gap-1 font-medium text-fg-link hover:underline">
        Open cycle
        <ArrowRight aria-hidden className="size-3" />
      </Link>
    </div>
  );
}

export function ProjectFrame({ children }: { readonly children: React.ReactNode }) {
  const { project, capabilities } = useCurrentProject();
  const pathname = usePathname() ?? '';
  const queryClient = useQueryClient();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const tab = activeTab(pathname, project.key);
  // The full task page (/p/OPS/42) is a focused document: no project header or tabs, the task
  // shows its own breadcrumb back to the project.
  const taskPage = /^\d+$/.test(frameSegment(pathname, project.key));
  const triage = useTriage(project.key, 'open', { staleTime: 30_000, enabled: !taskPage });
  const triageCount = triage.data?.counts.pending ?? 0;

  const toggleStar = async () => {
    const result = await starProjectAction({ projectId: project.id, starred: !project.starred });
    if (!result.ok) {
      toast.error("Couldn't update the star", result.error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
    void queryClient.invalidateQueries({ queryKey: qk.projects() });
  };

  const viewTabs = PROJECT_TABS.filter((t) => t !== 'settings');
  const tabs: FrameTab[] = [...viewTabs.slice(0, viewTabs.indexOf('workload') + 1), 'cycles', 'triage', ...viewTabs.slice(viewTabs.indexOf('workload') + 1), ...(capabilities['project:update'] ? (['settings'] as const) : [])];

  if (taskPage) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="project-frame" data-focus="task">
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project-frame">
      <header className="shrink-0 border-b border-border-subtle bg-panel">
        <div className="flex flex-wrap items-center gap-3 px-6 pt-4">
          <EntityIcon icon={project.icon} color={project.color} size={32} />
          <div className="min-w-0 flex-1 basis-[calc(100%-56px)] sm:basis-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-fg">{project.name}</h1>
              <IconButton
                label={project.starred ? 'Remove star' : 'Star this project'}
                icon={<Star aria-hidden className={cn(project.starred && 'fill-warning text-warning')} />}
                size="sm"
                onClick={() => void toggleStar()}
              />
              <ProjectHealthBadge project={project} />
            </div>
            <p className="truncate text-xs text-fg-muted">
              <span className="font-mono">{project.key}</span> · {project.progress.done} of {project.progress.total} tasks done
              {project.healthNote ? ` · ${project.healthNote}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AvatarGroup className="hidden -space-x-1 sm:flex" people={project.members.map((m) => ({ id: m.userId, name: m.person.name, src: m.person.image }))} max={4} size="md" />
            {capabilities['project:update'] ? (
              <Link href={`${routes.projectTab(project.key, 'settings')}?section=members`} className="hidden sm:block">
                <Button variant="secondary" size="sm" leadingIcon={<Users aria-hidden />}>
                  Share
                </Button>
              </Link>
            ) : null}
            {capabilities['task:create'] ? (
              <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => openQuickAdd({ projectId: project.id })} data-testid="project-add-task">
                Add task
              </Button>
            ) : null}
          </div>
        </div>
        <nav aria-label="Project views" className="mt-2 flex gap-1 overflow-x-auto px-4">
          {tabs.map((t) => {
            const meta = TAB_META[t];
            const Icon = meta.icon;
            const active = tab === t;
            return (
              <Link
                key={t}
                href={t === 'cycles' ? routes.projectCycles(project.key) : t === 'triage' ? routes.projectTriage(project.key) : routes.projectTab(project.key, t)}
                // Tab pages are thin client views over the shared task cache: prefetch them fully
                // so switching tabs only re-renders (no loading skeleton, no server round trip).
                prefetch
                aria-current={active ? 'page' : undefined}
                data-testid={`project-tab-${t}`}
                className={cn(
                  'relative flex h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap outline-none',
                  'focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                  active ? 'text-fg' : 'text-fg-secondary hover:text-fg',
                )}
              >
                <Icon aria-hidden className="size-4" />
                {meta.label}
                {t === 'triage' && triageCount > 0 ? <CountBadge count={triageCount} tone="primary" ringClassName="ring-transparent" label={`${triageCount} waiting`} /> : null}
                <span aria-hidden className={cn('absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
              </Link>
            );
          })}
        </nav>
        {tab === 'board' || tab === 'list' ? <CycleStrip projectKey={project.key} /> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

