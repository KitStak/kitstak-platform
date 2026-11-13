'use client';
/** Project header (icon, name, health, star, members, share) and the view tab strip. */
import { useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, CalendarDays, GanttChart, Inbox, KanbanSquare, LayoutDashboard, List, Plus, Repeat, Settings2, Star, Table2, Users, Activity, Paperclip } from 'lucide-react';
import { AvatarGroup, Button, CountBadge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, ProgressBar, cn, toast } from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { cycleDaysLeft } from '@/lib/cycle-math';
import { formatRange, todayIso } from '@/lib/dates';
import { useCycles, useTriage } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { PROJECT_TABS, routes, type ProjectTab } from '@/lib/routes';
import { starProjectAction } from '@/server/actions/projects';
import { useShellStore } from '@/features/shell/store';
import { ProjectHealthBadge } from './health';
import { useCustomer360 } from '@/features/integrations/customer-360-strip';
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

function tabHref(projectKey: string, t: FrameTab): string {
  return t === 'cycles' ? routes.projectCycles(projectKey) : t === 'triage' ? routes.projectTriage(projectKey) : routes.projectTab(projectKey, t);
}

const tabClass = 'relative flex h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap outline-none';
/** Room kept for the "More" button when some tabs do not fit. */
const MORE_ROOM = 92;

/**
 * The view tab strip. Tabs that do not fit the width fold into a "More" menu (never cut at the
 * edge); the active tab always stays visible. Widths come from an invisible measuring copy.
 */
function ProjectTabs({ tabs, active, projectKey, triageCount }: { readonly tabs: readonly FrameTab[]; readonly active: FrameTab | null; readonly projectKey: string; readonly triageCount: number }) {
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const update = () => {
      const widths = (Array.from(measure.children) as HTMLElement[]).map((el) => el.offsetWidth + 4);
      const available = nav.clientWidth - 32;
      const total = widths.reduce((sum, w) => sum + w, 0);
      let count = tabs.length;
      if (total > available) {
        let used = 0;
        count = 0;
        while (count < widths.length && used + (widths[count] ?? 0) <= available - MORE_ROOM) {
          used += widths[count] ?? 0;
          count += 1;
        }
        count = Math.max(1, count);
      }
      setVisibleCount((previous) => (previous === count ? previous : count));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [tabs]);

  let shown = tabs.slice(0, visibleCount);
  // Keep the active tab visible: it takes the place of the last tab that fits.
  if (active && !shown.includes(active) && tabs.includes(active)) shown = [...shown.slice(0, -1), active];
  const overflow = tabs.filter((t) => !shown.includes(t));

  const renderInner = (t: FrameTab) => {
    const meta = TAB_META[t];
    const Icon = meta.icon;
    return (
      <>
        <Icon aria-hidden className="size-4" />
        {meta.label}
        {t === 'triage' && triageCount > 0 ? <CountBadge count={triageCount} tone="primary" ringClassName="ring-transparent" label={`${triageCount} waiting`} /> : null}
      </>
    );
  };

  return (
    <nav ref={navRef} aria-label="Project views" className="relative mt-2 flex gap-1 overflow-hidden px-4">
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex gap-1">
        {tabs.map((t) => (
          <span key={t} className={tabClass}>
            {renderInner(t)}
          </span>
        ))}
      </div>
      {shown.map((t) => {
        const isActive = active === t;
        return (
          <Link
            key={t}
            href={tabHref(projectKey, t)}
            // Tab pages are thin client views over the shared task cache: prefetch them fully
            // so switching tabs only re-renders (no loading skeleton, no server round trip).
            prefetch
            aria-current={isActive ? 'page' : undefined}
            data-testid={`project-tab-${t}`}
            className={cn(
              tabClass,
              'focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
              isActive ? 'text-fg' : 'text-fg-secondary hover:text-fg',
            )}
          >
            {renderInner(t)}
            <span aria-hidden className={cn('absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
          </Link>
        );
      })}
      {overflow.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(tabClass, 'text-fg-secondary hover:text-fg focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus data-[state=open]:text-fg')} data-testid="project-tab-more">
              More
              <ChevronDown aria-hidden className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {overflow.map((t) => {
              const Icon = TAB_META[t].icon;
              return (
                <DropdownMenuItem key={t} icon={<Icon aria-hidden className="size-4" />} onSelect={() => router.push(tabHref(projectKey, t))} data-testid={`project-tab-more-${t}`}>
                  {TAB_META[t].label}
                  {t === 'triage' && triageCount > 0 ? <span className="ml-auto text-2xs text-fg-muted tabular-nums">{triageCount}</span> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}

export function ProjectFrame({ children }: { readonly children: React.ReactNode }) {
  const { project, capabilities } = useCurrentProject();
  const [noteOpen, setNoteOpen] = useState(false);
  const pathname = usePathname() ?? '';
  const queryClient = useQueryClient();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const tab = activeTab(pathname, project.key);
  // The full task page (/p/OPS/42) is a focused document: no project header or tabs, the task
  // shows its own breadcrumb back to the project.
  const taskPage = /^\d+$/.test(frameSegment(pathname, project.key));
  const triage = useTriage(project.key, 'open', { staleTime: 30_000, enabled: !taskPage });
  const triageCount = triage.data?.counts.pending ?? 0;
  // Live CRM and warehouse risks: listed as customer notes in the health chip popover, never a health change.
  const customer = useCustomer360(project.key, { enabled: !taskPage });

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
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3 sm:px-6 sm:pt-4">
          <span className="max-sm:hidden">
            <EntityIcon icon={project.icon} color={project.color} size={32} />
          </span>
          <div className="min-w-0 flex-1 basis-[calc(100%-56px)] max-sm:basis-full sm:basis-0">
            {/* Phones: one line, the title and the health chip. Details live on Overview. */}
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="min-w-0 truncate text-xl font-semibold tracking-[-0.01em] text-fg max-sm:text-lg max-sm:leading-snug" title={project.name}>{project.name}</h1>
              <IconButton
                label={project.starred ? 'Remove star' : 'Star this project'}
                icon={<Star aria-hidden className={cn(project.starred && 'fill-warning text-warning')} />}
                size="sm"
                onClick={() => void toggleStar()}
              />
              <ProjectHealthBadge project={project} canEdit={capabilities['project:update']} risks={customer.data?.risks ?? []} />
            </div>
            <p className="truncate text-xs text-fg-muted max-sm:hidden">
              <span className="font-key">{project.key}</span> · {project.progress.done} of {project.progress.total} tasks done
              {project.healthNote ? ` · ${project.healthNote}` : ''}
            </p>
            {/* Phones: progress on its own line, the latest update as a tappable line that opens in full. */}
            <div className={cn('text-xs text-fg-muted sm:hidden', tab !== 'overview' && 'hidden')} data-testid="project-phone-meta">
              <p>
                <span className="font-key">{project.key}</span> · {project.progress.done} of {project.progress.total} tasks done
              </p>
              {project.healthNote ? (
                <button type="button" onClick={() => setNoteOpen((open) => !open)} aria-expanded={noteOpen} className={cn('mt-0.5 block w-full rounded-xs text-left outline-none focus-visible:outline-2 focus-visible:outline-focus', !noteOpen && 'line-clamp-2')}>
                  {project.healthNote}
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 max-sm:hidden">
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
        <ProjectTabs tabs={tabs} active={tab} projectKey={project.key} triageCount={triageCount} />
        {capabilities['task:create'] ? (
          <button
            type="button"
            aria-label={`Add a task to ${project.name}`}
            onClick={() => openQuickAdd({ projectId: project.id })}
            className="fixed right-4 bottom-[calc(20px+env(safe-area-inset-bottom))] z-[var(--z-sticky)] inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg outline-none hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-95 sm:hidden"
            data-testid="project-add-task-fab"
          >
            <Plus aria-hidden className="size-6" />
          </button>
        ) : null}
        {tab === 'board' || tab === 'list' ? <CycleStrip projectKey={project.key} /> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

