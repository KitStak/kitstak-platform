'use client';
/**
 * Projects directory (portfolio): every project you can see as cards or a sortable table,
 * grouped by space. Filter by status, health, space and stars; search by name or key; star,
 * archive / restore and delete (with undo) right from the card menu.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  Copy,
  ExternalLink,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Select,
  ToggleGroup,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { DueDate, EntityIcon, PersonAvatar } from '@/components/pm';
import { Page } from '@/components/layout/page';
import { SampleProjectButton } from '@/features/onboarding/sample-project-button';
import { PROJECT_HEALTHS, PROJECT_HEALTH_LABELS, PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectHealth, type ProjectStatus } from '@/lib/constants';
import { useProjects, useSpaces } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { ProjectSummary, SpaceDTO } from '@/lib/types';
import { archiveProjectAction, deleteProjectAction, duplicateProjectAction, restoreProjectAction, starProjectAction } from '@/server/actions/projects';
import { useShell } from '@/features/shell/shell-context';
import { ProgressRing } from '@/features/dashboards/charts';
import { HealthBadge } from './health';

export { HealthBadge } from './health';

type SortKey = 'name' | 'due' | 'progress' | 'health' | 'updated';
type Layout = 'cards' | 'table';

const HEALTH_ORDER: Readonly<Record<ProjectHealth, number>> = { off_track: 0, at_risk: 1, on_track: 2 };
const PREFS_KEY = 'ks-projects:directory';

interface DirectoryPrefs {
  readonly layout: Layout;
  readonly grouped: boolean;
  readonly sort: SortKey;
  readonly dir: 'asc' | 'desc';
}

const DEFAULT_PREFS: DirectoryPrefs = { layout: 'cards', grouped: true, sort: 'health', dir: 'asc' };

const PREFS_EVENT = 'ks-projects:directory-prefs';

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
}

function subscribePrefs(callback: () => void): () => void {
  window.addEventListener(PREFS_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(PREFS_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

/** Layout / grouping / sort remembered per browser (server renders the defaults, then this kicks in). */
function useDirectoryPrefs(): [DirectoryPrefs, (patch: Partial<DirectoryPrefs>) => void] {
  const raw = useSyncExternalStore(subscribePrefs, readRaw, () => null);
  const prefs = useMemo<DirectoryPrefs>(() => {
    if (!raw) return DEFAULT_PREFS;
    try {
      return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<DirectoryPrefs>) };
    } catch {
      return DEFAULT_PREFS;
    }
  }, [raw]);
  const setPrefs = (patch: Partial<DirectoryPrefs>) => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, ...patch }));
    } catch {
      // Private mode: the choice just isn't remembered.
    }
    window.dispatchEvent(new Event(PREFS_EVENT));
  };
  return [prefs, setPrefs];
}

function sortProjects(list: readonly ProjectSummary[], sort: SortKey, dir: 'asc' | 'desc'): ProjectSummary[] {
  const sign = dir === 'asc' ? 1 : -1;
  const compare = (a: ProjectSummary, b: ProjectSummary): number => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'due':
        return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
      case 'progress':
        return a.progress.percent - b.progress.percent;
      case 'health':
        return HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
      case 'updated':
        return b.updatedAt.localeCompare(a.updatedAt);
    }
  };
  return [...list].sort((a, b) => sign * compare(a, b) || a.name.localeCompare(b.name));
}

const ringTone = (health: ProjectHealth) => (health === 'off_track' ? 'danger' : health === 'at_risk' ? 'warning' : 'primary');

/** Star / archive / restore / delete with optimistic cache updates and undo toasts. */
function useProjectOps() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.projects() });
    router.refresh();
  };
  const patchCaches = (projectId: string, patch: Partial<ProjectSummary>) => {
    queryClient.setQueriesData<ProjectSummary[]>({ queryKey: qk.projects() }, (old) => (Array.isArray(old) ? old.map((p) => (p.id === projectId ? { ...p, ...patch } : p)) : old));
  };
  return {
    star: async (project: ProjectSummary) => {
      patchCaches(project.id, { starred: !project.starred });
      const result = await starProjectAction({ projectId: project.id, starred: !project.starred });
      if (!result.ok) {
        patchCaches(project.id, { starred: project.starred });
        toast.error("Couldn't update the star", result.error.message);
        return;
      }
      toast.success(project.starred ? `Removed ${project.name} from Starred` : `Starred ${project.name}`);
      refresh();
    },
    archive: async (project: ProjectSummary, archived: boolean) => {
      const result = await archiveProjectAction({ projectId: project.id, archived });
      if (!result.ok) {
        toast.error(archived ? "Couldn't archive the project" : "Couldn't restore the project", result.error.message);
        return;
      }
      refresh();
      toast.undo(archived ? `Archived ${project.name}` : `Restored ${project.name}`, {
        onUndo: async () => {
          const undo = await archiveProjectAction({ projectId: project.id, archived: !archived });
          if (!undo.ok) throw new Error(undo.error.message);
          refresh();
        },
      });
    },
    remove: async (project: ProjectSummary) => {
      const result = await deleteProjectAction({ projectId: project.id });
      if (!result.ok) {
        toast.error("Couldn't delete the project", result.error.message);
        return;
      }
      refresh();
      toast.undo(`Deleted ${project.name}`, {
        onUndo: async () => {
          const undo = await restoreProjectAction({ projectId: project.id });
          if (!undo.ok) throw new Error(undo.error.message);
          refresh();
        },
      });
    },
    duplicate: async (project: ProjectSummary) => {
      const pending = toast.loading(`Copying ${project.name}…`);
      const result = await duplicateProjectAction({ projectId: project.id, name: `${project.name} (copy)`, includeTasks: true });
      toast.dismiss(pending);
      if (!result.ok) {
        toast.error("Couldn't copy the project", result.error.message);
        return;
      }
      refresh();
      toast.success(`Created ${result.data.name}`, 'Opening your copy now.');
      router.push(routes.project(result.data.key));
    },
  };
}

function ProjectMenu({ project, ops, canCreate }: { readonly project: ProjectSummary; readonly ops: ReturnType<typeof useProjectOps>; readonly canCreate: boolean }) {
  const router = useRouter();
  const canEdit = project.role === 'owner' || project.role === 'editor';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`More actions for ${project.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" data-testid="project-menu" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={() => router.push(routes.project(project.key))}>
          Open project
        </DropdownMenuItem>
        <DropdownMenuItem icon={<BarChart3 aria-hidden />} onSelect={() => router.push(`${routes.dashboards()}?project=${project.key}`)}>
          See reports
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Star aria-hidden />} onSelect={() => void ops.star(project)}>
          {project.starred ? 'Remove star' : 'Star project'}
        </DropdownMenuItem>
        {canCreate && !project.archivedAt ? (
          <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={() => void ops.duplicate(project)}>
            Make a copy
          </DropdownMenuItem>
        ) : null}
        {canEdit ? (
          <>
            <DropdownMenuItem icon={<Settings2 aria-hidden />} onSelect={() => router.push(routes.projectTab(project.key, 'settings'))}>
              Project settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={project.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />} onSelect={() => void ops.archive(project, !project.archivedAt)}>
              {project.archivedAt ? 'Restore project' : 'Archive project'}
            </DropdownMenuItem>
          </>
        ) : null}
        {project.role === 'owner' ? (
          <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => void ops.remove(project)}>
            Delete project
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StarButton({ project, ops }: { readonly project: ProjectSummary; readonly ops: ReturnType<typeof useProjectOps> }) {
  return (
    <IconButton
      label={project.starred ? `Remove star from ${project.name}` : `Star ${project.name}`}
      icon={<Star aria-hidden className={cn(project.starred && 'fill-warning text-warning')} />}
      size="sm"
      aria-pressed={project.starred}
      onClick={() => void ops.star(project)}
      className={cn(!project.starred && 'opacity-60 group-hover:opacity-100 focus-visible:opacity-100')}
    />
  );
}

function ProjectCard({ project, space, ops, canCreate }: { readonly project: ProjectSummary; readonly space?: SpaceDTO; readonly ops: ReturnType<typeof useProjectOps>; readonly canCreate: boolean }) {
  return (
    <article
      data-testid="project-card"
      className={cn(
        'group relative flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs',
        'transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-out hover:-translate-y-px hover:border-border-default hover:shadow-sm motion-reduce:hover:translate-y-0',
        'focus-within:border-border-default',
        project.archivedAt && 'opacity-80',
      )}
    >
      <div className="flex items-start gap-3">
        <EntityIcon icon={project.icon} color={project.color} size={36} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-fg">
            <Link href={routes.project(project.key)} className="outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-focus">
              {project.name}
            </Link>
          </h3>
          <p className="truncate text-xs text-fg-muted">
            <span className="font-mono">{project.key}</span>
            {space ? ` · ${space.name}` : ''} · {project.archivedAt ? 'Archived' : PROJECT_STATUS_LABELS[project.status]}
          </p>
        </div>
        <div className="relative z-[1] -mt-1 -mr-1 flex items-center">
          <StarButton project={project} ops={ops} />
          <ProjectMenu project={project} ops={ops} canCreate={canCreate} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ProgressRing percent={project.progress.percent} size={48} strokeWidth={4.5} label={`${project.name} progress`} tone={ringTone(project.health)} />
        <div className="min-w-0 flex-1">
          <div className="mb-1">
            <HealthBadge health={project.health} />
          </div>
          <p className="truncate text-xs text-fg-secondary">
            {project.progress.total === 0 ? 'No tasks yet' : `${project.progress.done} of ${project.progress.total} tasks done`}
            {project.progress.overdue > 0 ? <span className="font-medium text-danger-text"> · {project.progress.overdue} overdue</span> : null}
          </p>
        </div>
      </div>
      {project.healthNote ? <p className="line-clamp-2 text-sm text-fg-secondary">{project.healthNote}</p> : null}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-subtle pt-3 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <PersonAvatar userId={project.ownerId} size="xs" showName />
          <Tooltip content={`${project.memberCount} ${project.memberCount === 1 ? 'person' : 'people'} on this project`}>
            <span tabIndex={0} className="relative z-[1] inline-flex shrink-0 items-center gap-1 rounded-sm text-fg-muted outline-none focus-visible:outline-2 focus-visible:outline-focus">
              <Users aria-hidden className="size-3.5" />
              <span className="tabular-nums">{project.memberCount}</span>
            </span>
          </Tooltip>
        </span>
        {project.dueDate ? <DueDate date={project.dueDate} done={project.status === 'completed'} /> : <span className="text-fg-muted">No due date</span>}
      </div>
    </article>
  );
}

function SortHeader({ label, sortKey, sort, dir, onSort, className }: { readonly label: string; readonly sortKey: SortKey; readonly sort: SortKey; readonly dir: 'asc' | 'desc'; readonly onSort: (key: SortKey) => void; readonly className?: string }) {
  const active = sort === sortKey;
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-3 py-2.5 font-medium', className)}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
        {label}
        {active ? dir === 'asc' ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" /> : null}
      </button>
    </th>
  );
}

function ProjectTable({
  projects,
  spaceById,
  ops,
  canCreate,
  sort,
  dir,
  onSort,
}: {
  readonly projects: readonly ProjectSummary[];
  readonly spaceById: ReadonlyMap<string, SpaceDTO>;
  readonly ops: ReturnType<typeof useProjectOps>;
  readonly canCreate: boolean;
  readonly sort: SortKey;
  readonly dir: 'asc' | 'desc';
  readonly onSort: (key: SortKey) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-panel shadow-xs">
      <table className="w-full min-w-[920px] text-sm" data-testid="projects-table">
        <thead className="border-b border-border-subtle bg-sunken/40 text-left text-xs text-fg-muted">
          <tr>
            <th scope="col" className="w-10 px-2 py-2.5">
              <span className="sr-only">Starred</span>
            </th>
            <SortHeader label="Project" sortKey="name" sort={sort} dir={dir} onSort={onSort} className="pl-1" />
            <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
            <SortHeader label="Health" sortKey="health" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader label="Progress" sortKey="progress" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col" className="px-3 py-2.5 font-medium">Owner</th>
            <th scope="col" className="px-3 py-2.5 font-medium">People</th>
            <SortHeader label="Due" sortKey="due" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col" className="w-10 px-2 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const space = project.spaceId ? spaceById.get(project.spaceId) : undefined;
            return (
              <tr key={project.id} className="group border-b border-border-subtle last:border-0 hover:bg-hover" data-testid="project-row">
                <td className="px-2 py-2">
                  <StarButton project={project} ops={ops} />
                </td>
                <td className="py-2 pr-3 pl-1">
                  <Link href={routes.project(project.key)} className="flex min-w-0 items-center gap-2.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus">
                    <EntityIcon icon={project.icon} color={project.color} size={24} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-fg group-hover:underline">{project.name}</span>
                      <span className="block truncate text-xs text-fg-muted">
                        <span className="font-mono">{project.key}</span>
                        {space ? ` · ${space.name}` : ''}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-fg-secondary">{project.archivedAt ? 'Archived' : PROJECT_STATUS_LABELS[project.status]}</td>
                <td className="px-3 py-2">
                  <HealthBadge health={project.health} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <ProgressRing percent={project.progress.percent} size={28} strokeWidth={3} showLabel={false} label={`${project.name} progress`} tone={ringTone(project.health)} />
                    <span className="text-xs text-fg-secondary tabular-nums">
                      <strong className="font-semibold text-fg">{project.progress.percent}%</strong> · {project.progress.done}/{project.progress.total}
                    </span>
                    {project.progress.overdue ? <Badge tone="danger" size="sm">{project.progress.overdue} late</Badge> : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <PersonAvatar userId={project.ownerId} size="xs" showName />
                </td>
                <td className="px-3 py-2 text-fg-secondary tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <Users aria-hidden className="size-3.5 text-icon" />
                    {project.memberCount}
                  </span>
                </td>
                <td className="px-3 py-2">{project.dueDate ? <DueDate date={project.dueDate} done={project.status === 'completed'} /> : <span className="text-xs text-fg-muted">None</span>}</td>
                <td className="px-2 py-2">
                  <ProjectMenu project={project} ops={ops} canCreate={canCreate} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SpaceSection({ title, icon, count, children, defaultOpen = true, id }: { readonly title: string; readonly icon: ReactNode; readonly count: number; readonly children: ReactNode; readonly defaultOpen?: boolean; readonly id: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section aria-labelledby={`space-${id}`} className="flex flex-col gap-3" data-testid="space-group">
      <h2 id={`space-${id}`} className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="-ml-1 inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-sm font-semibold text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
        >
          <ChevronDown aria-hidden className={cn('size-4 text-icon transition-transform duration-[var(--duration-fast)]', !open && '-rotate-90')} />
          {icon}
          {title}
          <span className="rounded-full bg-sunken px-1.5 text-xs font-medium text-fg-muted tabular-nums">{count}</span>
        </button>
      </h2>
      {open ? children : null}
    </section>
  );
}

export function ProjectsDirectory({ initialProjects, initialSpaces, spaceFilter }: { readonly initialProjects: ProjectSummary[]; readonly initialSpaces: SpaceDTO[]; readonly spaceFilter?: string }) {
  const { can } = useShell();
  const canCreate = can('project:create');
  const ops = useProjectOps();
  const [prefs, setPrefs] = useDirectoryPrefs();
  const [query, setQuery] = useState('');
  const [space, setSpace] = useState<string>(spaceFilter ?? 'all');
  const [status, setStatus] = useState<'all' | ProjectStatus>('all');
  const [health, setHealth] = useState<'all' | ProjectHealth>('all');
  const [starredOnly, setStarredOnly] = useState(false);
  const [archived, setArchived] = useState(false);
  const active = useProjects({}, { initialData: initialProjects });
  const withArchived = useProjects({ archived: true }, { enabled: archived });
  const spaces = useSpaces({ initialData: initialSpaces });
  const spaceById = useMemo(() => new Map((spaces.data ?? []).map((s) => [s.id, s])), [spaces.data]);

  // Follow the sidebar's space links (?space=…) when they change.
  const [spaceProp, setSpaceProp] = useState(spaceFilter);
  if (spaceProp !== spaceFilter) {
    setSpaceProp(spaceFilter);
    setSpace(spaceFilter ?? 'all');
  }

  const source = archived ? (withArchived.data ?? []).filter((p) => p.archivedAt) : (active.data ?? []).filter((p) => !p.archivedAt);
  const loading = archived && withArchived.isPending;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = source.filter(
      (p) =>
        !p.isTemplate &&
        (space === 'all' || (space === 'none' ? p.spaceId === null : p.spaceId === space)) &&
        (status === 'all' || p.status === status) &&
        (health === 'all' || p.health === health) &&
        (!starredOnly || p.starred) &&
        (!q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)),
    );
    return sortProjects(list, prefs.sort, prefs.dir);
  }, [source, query, space, status, health, starredOnly, prefs.sort, prefs.dir]);

  const groups = useMemo(() => {
    if (!prefs.grouped) return null;
    const bySpace = new Map<string, ProjectSummary[]>();
    for (const project of filtered) {
      const key = project.spaceId && spaceById.has(project.spaceId) ? project.spaceId : 'none';
      bySpace.set(key, [...(bySpace.get(key) ?? []), project]);
    }
    const ordered = (spaces.data ?? []).filter((s) => bySpace.has(s.id)).map((s) => ({ id: s.id, space: s as SpaceDTO | null, projects: bySpace.get(s.id) ?? [] }));
    if (bySpace.has('none')) ordered.push({ id: 'none', space: null, projects: bySpace.get('none') ?? [] });
    return ordered;
  }, [filtered, prefs.grouped, spaceById, spaces.data]);

  const counts = useMemo(() => {
    const live = (active.data ?? []).filter((p) => !p.archivedAt && !p.isTemplate);
    return { total: live.length, atRisk: live.filter((p) => p.health === 'at_risk').length, offTrack: live.filter((p) => p.health === 'off_track').length, starred: live.filter((p) => p.starred).length };
  }, [active.data]);

  const filtersOn = query.trim() !== '' || space !== 'all' || status !== 'all' || health !== 'all' || starredOnly;
  const clearFilters = () => {
    setQuery('');
    setSpace('all');
    setStatus('all');
    setHealth('all');
    setStarredOnly(false);
  };
  const onSort = (key: SortKey) => setPrefs(prefs.sort === key ? { dir: prefs.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: 'asc' });

  const renderList = (list: readonly ProjectSummary[]) =>
    prefs.layout === 'cards' ? (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="projects-grid">
        {list.map((project) => (
          <ProjectCard key={project.id} project={project} space={prefs.grouped ? undefined : project.spaceId ? spaceById.get(project.spaceId) : undefined} ops={ops} canCreate={canCreate} />
        ))}
      </div>
    ) : (
      <ProjectTable projects={list} spaceById={spaceById} ops={ops} canCreate={canCreate} sort={prefs.sort} dir={prefs.dir} onSort={onSort} />
    );

  return (
    <Page
      title="Projects"
      subtitle={
        counts.total === 0 ? (
          'Every project your team is working on, with health and progress at a glance.'
        ) : (
          <span>
            {counts.total} active {counts.total === 1 ? 'project' : 'projects'}
            {counts.offTrack ? <span className="text-danger-text"> · {counts.offTrack} off track</span> : null}
            {counts.atRisk ? <span className="text-warning-text"> · {counts.atRisk} at risk</span> : null}
            {!counts.offTrack && !counts.atRisk ? ' · all on track' : null}
          </span>
        )
      }
      actions={
        <>
          <Link href={routes.dashboards()} className="hidden sm:block">
            <Button variant="secondary" leadingIcon={<BarChart3 aria-hidden />}>
              Reports
            </Button>
          </Link>
          {canCreate ? (
            <Link href={routes.newProject()}>
              <Button leadingIcon={<Plus aria-hidden />} data-testid="new-project">
                New project
              </Button>
            </Link>
          ) : null}
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="projects-filters">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder="Find a project by name or key"
          leadingIcon={<Search aria-hidden />}
          aria-label="Find a project"
          containerClassName="w-full sm:w-64"
        />
        <Select
          aria-label="Space"
          value={space}
          onValueChange={setSpace}
          options={[{ value: 'all', label: 'All spaces' }, ...(spaces.data ?? []).map((s) => ({ value: s.id, label: s.name })), { value: 'none', label: 'Other projects' }]}
          className="w-[calc(50%-4px)] sm:w-40"
        />
        <Select
          aria-label="Status"
          value={status}
          onValueChange={(value) => setStatus(value as 'all' | ProjectStatus)}
          options={[{ value: 'all', label: 'Any status' }, ...PROJECT_STATUSES.filter((s) => s !== 'archived').map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))]}
          className="w-[calc(50%-4px)] sm:w-36"
        />
        <Select
          aria-label="Health"
          value={health}
          onValueChange={(value) => setHealth(value as 'all' | ProjectHealth)}
          options={[{ value: 'all', label: 'Any health' }, ...PROJECT_HEALTHS.map((h) => ({ value: h, label: PROJECT_HEALTH_LABELS[h] }))]}
          className="w-[calc(50%-4px)] sm:w-36"
        />
        <Button
          variant={starredOnly ? 'secondary' : 'ghost'}
          size="md"
          aria-pressed={starredOnly}
          leadingIcon={<Star aria-hidden className={cn(starredOnly && 'fill-warning text-warning')} />}
          onClick={() => setStarredOnly(!starredOnly)}
          className="w-[calc(50%-4px)] sm:w-auto"
        >
          Starred{counts.starred ? ` (${counts.starred})` : ''}
        </Button>
        {filtersOn ? (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2" data-testid="projects-view-options">
        <p className="mr-auto text-sm text-fg-muted" aria-live="polite">
          {loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'project' : 'projects'}${filtersOn ? ' match' : ''}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            label="Show"
            value={archived ? 'archived' : 'active'}
            onValueChange={(value) => setArchived(value === 'archived')}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
          <ToggleGroup
            label="Group"
            value={prefs.grouped ? 'space' : 'none'}
            onValueChange={(value) => setPrefs({ grouped: value === 'space' })}
            options={[
              { value: 'space', label: 'By space' },
              { value: 'none', label: 'One list' },
            ]}
          />
          <ToggleGroup
            label="Layout"
            value={prefs.layout}
            onValueChange={(layout) => setPrefs({ layout })}
            className="ml-auto sm:ml-0"
            options={[
              { value: 'cards', label: 'Cards', icon: <LayoutGrid aria-hidden />, iconOnly: true },
              { value: 'table', label: 'Table', icon: <List aria-hidden />, iconOnly: true },
            ]}
          />
          {prefs.layout === 'cards' ? (
            <Select
              aria-label="Sort by"
              size="md"
              value={prefs.sort}
              onValueChange={(value) => setPrefs({ sort: value as SortKey, dir: 'asc' })}
              options={[
                { value: 'health', label: 'Needs attention first' },
                { value: 'due', label: 'Due soonest' },
                { value: 'progress', label: 'Least progress' },
                { value: 'name', label: 'Name A–Z' },
                { value: 'updated', label: 'Recently updated' },
              ]}
              className="w-44"
            />
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading projects">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="ks-skeleton h-[190px] rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          illustration={filtersOn ? 'search' : 'workspace'}
          title={archived ? (filtersOn ? 'No archived projects match' : 'No archived projects') : filtersOn ? 'No projects match these filters' : 'No projects yet'}
          description={
            archived
              ? 'When a project wraps up, archive it from its menu. It shows up here and you can restore it any time.'
              : filtersOn
                ? 'Try a different search or clear the filters to see everything.'
                : 'Start from a template to get a ready-made plan in seconds, or begin with a blank project.'
          }
          actions={
            filtersOn ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : canCreate && !archived ? (
              <>
                <Link href={routes.newProject()}>
                  <Button leadingIcon={<Plus aria-hidden />}>Create a project</Button>
                </Link>
                {/* Studio onboarding: a practice project to explore with. */}
                <SampleProjectButton />
              </>
            ) : null
          }
        />
      ) : groups ? (
        <div className="flex flex-col gap-7">
          {groups.map((group) => (
            <SpaceSection
              key={group.id}
              id={group.id}
              title={group.space?.name ?? 'Other projects'}
              count={group.projects.length}
              icon={group.space ? <EntityIcon icon={group.space.icon} color={group.space.color} size={20} /> : <EntityIcon icon="folder" color="gray" size={20} />}
            >
              {renderList(group.projects)}
            </SpaceSection>
          ))}
        </div>
      ) : (
        renderList(filtered)
      )}
    </Page>
  );
}
