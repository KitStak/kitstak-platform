'use client';
/** Project header (icon, name, health, star, members, share) and the view tab strip. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, GanttChart, KanbanSquare, LayoutDashboard, List, Plus, Settings2, Star, Table2, Users, Activity, Paperclip } from 'lucide-react';
import { AvatarGroup, Button, IconButton, cn, toast } from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { qk } from '@/lib/query-keys';
import { PROJECT_TABS, routes, type ProjectTab } from '@/lib/routes';
import { starProjectAction } from '@/server/actions/projects';
import { useShellStore } from '@/features/shell/store';
import { HealthBadge } from './health';
import { useCurrentProject } from './project-context';

const TAB_META: Readonly<Record<ProjectTab, { label: string; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }>> = {
  overview: { label: 'Overview', icon: LayoutDashboard },
  board: { label: 'Board', icon: KanbanSquare },
  list: { label: 'List', icon: List },
  table: { label: 'Table', icon: Table2 },
  timeline: { label: 'Timeline', icon: GanttChart },
  calendar: { label: 'Calendar', icon: CalendarDays },
  workload: { label: 'Workload', icon: Users },
  files: { label: 'Files', icon: Paperclip },
  activity: { label: 'Activity', icon: Activity },
  settings: { label: 'Settings', icon: Settings2 },
};

function activeTab(pathname: string, key: string): ProjectTab | null {
  const base = routes.project(key);
  if (pathname === base) return 'overview';
  const segment = pathname.slice(base.length + 1).split('/')[0];
  return (PROJECT_TABS as readonly string[]).includes(segment) ? (segment as ProjectTab) : null;
}

export function ProjectFrame({ children }: { readonly children: React.ReactNode }) {
  const { project, capabilities } = useCurrentProject();
  const pathname = usePathname() ?? '';
  const queryClient = useQueryClient();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const tab = activeTab(pathname, project.key);

  const toggleStar = async () => {
    const result = await starProjectAction({ projectId: project.id, starred: !project.starred });
    if (!result.ok) {
      toast.error("Couldn't update the star", result.error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
    void queryClient.invalidateQueries({ queryKey: qk.projects() });
  };

  const tabs = PROJECT_TABS.filter((t) => t !== 'settings' || capabilities['project:update']);

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
              <HealthBadge health={project.health} />
            </div>
            <p className="truncate text-xs text-fg-muted">
              <span className="font-mono">{project.key}</span> · {project.progress.done} of {project.progress.total} tasks done
              {project.healthNote ? ` · ${project.healthNote}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AvatarGroup className="hidden sm:flex" people={project.members.map((m) => ({ id: m.userId, name: m.person.name, src: m.person.image }))} max={4} size="sm" />
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
                href={routes.projectTab(project.key, t)}
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
                <span aria-hidden className={cn('absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
              </Link>
            );
          })}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

