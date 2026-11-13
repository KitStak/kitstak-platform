'use client';
/**
 * Dashboards: the portfolio rollup across every project, or one project's reports
 * (`/dashboards?project=OPS`). Filters live in the URL (`project`, `space`, `weeks`) so a view
 * can be bookmarked and shared. Charts are lightweight SVG (./charts) and theme aware.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { ArrowUpRight, FolderKanban, RefreshCw } from 'lucide-react';
import { Badge, Button, Combobox, EmptyState, IconButton, Select, Skeleton, ToggleGroup, cn } from '@/components/ui';
import { DueDate, EntityIcon, PersonAvatar } from '@/components/pm';
import { Page, Panel } from '@/components/layout/page';
import { PROJECT_HEALTH_LABELS, PROJECT_HEALTHS, type ProjectHealth } from '@/lib/constants';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useProjects, useReport, useSpaces } from '@/lib/hooks/use-data';
import { routes } from '@/lib/routes';
import type { ProjectSummary, ReportDTO, SpaceDTO } from '@/lib/types';
import { useShell } from '@/features/shell/shell-context';
import { ProjectHealthBadge, healthMismatch } from '@/features/projects/health';
import { healthProgressTone } from '@/lib/health';
import { ProgressRing } from './charts';
import { BurnPanel, CompletedPanel, CycleTimePanel, KpiTiles, OverduePanel, StatusPanel, VelocityPanel, WorkloadPanel } from './report-panels';

export interface DashboardsFilters {
  readonly project?: string;
  readonly space?: string;
  readonly weeks: number;
}

const WEEK_OPTIONS = [
  { value: '4', label: '4 weeks' },
  { value: '8', label: '8 weeks' },
  { value: '12', label: '12 weeks' },
] as const;

const HEALTH_TONE: Readonly<Record<ProjectHealth, string>> = { on_track: 'var(--success)', at_risk: 'var(--warning)', off_track: 'var(--danger)' };

function writeUrl(pathname: string, filters: DashboardsFilters, keep: URLSearchParams) {
  const params = new URLSearchParams(keep);
  for (const key of ['project', 'space', 'weeks']) params.delete(key);
  if (filters.project) params.set('project', filters.project);
  if (filters.space && !filters.project) params.set('space', filters.space);
  if (filters.weeks !== 8) params.set('weeks', String(filters.weeks));
  const query = params.toString();
  window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
}

function PortfolioProjects({ projects, spaces }: { readonly projects: readonly ProjectSummary[]; readonly spaces: ReadonlyMap<string, SpaceDTO> }) {
  const counts = PROJECT_HEALTHS.map((health) => ({ health, count: projects.filter((p) => p.health === health).length }));
  const total = Math.max(1, projects.length);
  // Needs attention: off track, or the numbers say worse than the owner's health. Those sort first.
  const attention = (project: ProjectSummary) => project.health === 'off_track' || healthMismatch(project);
  // Same count and words as the Projects directory: the amber dot means "needs a status check".
  const needsAttention = projects.filter((project) => healthMismatch(project)).length;
  const sorted = [...projects].sort((a, b) => Number(attention(b)) - Number(attention(a)));
  return (
    <Panel title="Projects at a glance" bodyClassName="p-0">
      <div className="border-b border-border-subtle px-4 py-3">
        <div className="flex h-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label={counts.map((c) => `${c.count} ${PROJECT_HEALTH_LABELS[c.health].toLowerCase()}`).join(', ')}>
          {counts.map((c) => (c.count ? <span key={c.health} style={{ width: `${(c.count / total) * 100}%`, background: HEALTH_TONE[c.health] }} /> : null))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
          {counts.map((c) => (
            <li key={c.health} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: HEALTH_TONE[c.health] }} />
              {PROJECT_HEALTH_LABELS[c.health]} <strong className="font-semibold text-fg tabular-nums">{c.count}</strong>
            </li>
          ))}
          {needsAttention ? (
            <li className="inline-flex items-center gap-1.5 font-medium text-warning-text" data-testid="needs-attention-count">
              <span aria-hidden className="size-2 rounded-full bg-warning" />
              Need a status check <strong className="font-semibold tabular-nums">{needsAttention}</strong>
            </li>
          ) : null}
        </ul>
      </div>
      {projects.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-fg-muted">No active projects in this view.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {sorted.map((project) => (
            <li key={project.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
              <ProgressRing percent={project.progress.percent} size={36} strokeWidth={3.5} label={`${project.name} progress`} tone={healthProgressTone(project.health)} />
              <div className="min-w-0 flex-1">
                <Link href={routes.project(project.key)} className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg hover:underline">
                  <EntityIcon icon={project.icon} color={project.color} size={18} />
                  <span className="truncate">{project.name}</span>
                </Link>
                <p className="text-xs text-fg-muted">
                  <span className="font-key">{project.key}</span>
                  {project.spaceId && spaces.get(project.spaceId) ? ` · ${spaces.get(project.spaceId)?.name}` : ''} · {project.progress.done} of {project.progress.total} done
                  {project.progress.overdue ? <span className="text-danger-text"> · {project.progress.overdue} overdue</span> : null}
                </p>
              </div>
              <span className="hidden sm:block">
                <DueDate date={project.dueDate} done={project.status === 'completed'} />
              </span>
              <ProjectHealthBadge project={project} canEdit={false} />
              <Link
                href={`${routes.dashboards()}?project=${project.key}`}
                className="hidden rounded-md px-2 py-1 text-xs font-medium text-fg-link outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus md:inline-flex"
                aria-label={`Reports for ${project.name}`}
              >
                Reports
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading reports">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={104} rounded="lg" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Skeleton height={340} rounded="lg" />
        <Skeleton height={340} rounded="lg" />
      </div>
    </div>
  );
}

export function DashboardsView({ initialReport, initialProjects, initialFilters }: { readonly initialReport: ReportDTO | null; readonly initialProjects: ProjectSummary[]; readonly initialFilters: DashboardsFilters }) {
  const pathname = usePathname() ?? '/dashboards';
  const searchParams = useSearchParams();
  const { can } = useShell();
  const [filters, setFiltersState] = useState<DashboardsFilters>(initialFilters);
  const projects = useProjects({}, { initialData: initialProjects });
  const spaces = useSpaces();
  const people = usePeopleMap();
  // Same words as /projects: "7 active projects" (completed ones are counted apart, not hidden in the total).
  const scopeLabel = (total: number) => {
    const scoped = (projects.data ?? []).filter((p) => p.status !== 'archived' && (!filters.space || p.spaceId === filters.space));
    if (scoped.length !== total) return `${total} ${total === 1 ? 'project' : 'projects'}`;
    const completed = scoped.filter((p) => p.status === 'completed').length;
    const active = total - completed;
    return `${active} active ${active === 1 ? 'project' : 'projects'}${completed ? ` and ${completed} completed` : ''}`;
  };
  const isInitial = filters.project === initialFilters.project && filters.space === initialFilters.space && filters.weeks === initialFilters.weeks;
  const report = useReport(
    { project: filters.project, space: filters.project ? null : (filters.space ?? null), weeks: filters.weeks },
    { initialData: isInitial && initialReport ? initialReport : undefined },
  );

  const setFilters = useCallback(
    (patch: Partial<DashboardsFilters>) => {
      setFiltersState((current) => {
        const next = { ...current, ...patch };
        writeUrl(pathname, next, new URLSearchParams(searchParams?.toString() ?? ''));
        return next;
      });
    },
    [pathname, searchParams],
  );

  const projectList = useMemo(() => (projects.data ?? []).filter((p) => !p.archivedAt && !p.isTemplate), [projects.data]);
  const spaceById = useMemo(() => new Map((spaces.data ?? []).map((s) => [s.id, s])), [spaces.data]);
  const selected = filters.project ? projectList.find((p) => p.key === filters.project) : undefined;
  const portfolioProjects = useMemo(
    () => projectList.filter((p) => !filters.space || p.spaceId === filters.space).sort((a, b) => ({ off_track: 0, at_risk: 1, on_track: 2 })[a.health] - ({ off_track: 0, at_risk: 1, on_track: 2 })[b.health]),
    [projectList, filters.space],
  );
  const personText = useCallback((id: string | null) => (id ? (people.get(id)?.name ?? 'Former member') : 'Unassigned'), [people]);
  const taskHref = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (filters.project) params.set('project', filters.project);
      params.set('task', key);
      return `${pathname}?${params.toString()}`;
    },
    [pathname, searchParams, filters.project],
  );

  const data = report.data;
  const subtitle = selected
    ? `Reports for ${selected.name}: progress, pace and who is working on what.`
    : `How every project is doing, in one place${filters.space && spaceById.get(filters.space) ? ` (${spaceById.get(filters.space)?.name})` : ''}.`;

  return (
    <Page
      title={selected ? `${selected.name} reports` : 'Dashboards'}
      subtitle={subtitle}
      breadcrumbs={selected ? [{ label: 'Dashboards', href: routes.dashboards() }, { label: selected.name }] : undefined}
      actions={
        <>
          <IconButton
            label="Refresh"
            icon={<RefreshCw aria-hidden className={cn(report.isFetching && 'animate-spin motion-reduce:animate-none')} />}
            onClick={() => void report.refetch()}
          />
          {selected ? (
            <Link href={routes.project(selected.key)}>
              <Button variant="secondary" leadingIcon={<ArrowUpRight aria-hidden />}>
                Open project
              </Button>
            </Link>
          ) : null}
        </>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-2" data-testid="dashboard-filters">
        <Combobox
          aria-label="Show reports for"
          className="w-full sm:w-64"
          value={filters.project ?? 'all'}
          onValueChange={(value) => setFilters({ project: !value || value === 'all' ? undefined : value })}
          searchPlaceholder="Find a project"
          emptyMessage="No projects match"
          options={[
            { value: 'all', label: 'All projects', icon: <FolderKanban aria-hidden className="size-4 text-icon" />, description: 'Portfolio rollup' },
            ...projectList.map((p) => ({ value: p.key, label: p.name, description: p.key, keywords: [p.key], icon: <EntityIcon icon={p.icon} color={p.color} size={18} /> })),
          ]}
        />
        {!filters.project && (spaces.data ?? []).length > 0 ? (
          <Select
            aria-label="Space"
            className="w-full sm:w-44"
            value={filters.space ?? 'all'}
            onValueChange={(value) => setFilters({ space: value === 'all' ? undefined : value })}
            options={[{ value: 'all', label: 'All spaces' }, ...(spaces.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
          />
        ) : null}
        <ToggleGroup
          label="Time range"
          className="sm:ml-auto"
          value={String(filters.weeks) as '4' | '8' | '12'}
          onValueChange={(value) => setFilters({ weeks: Number(value) })}
          options={WEEK_OPTIONS}
        />
        {data?.scope.kind === 'portfolio' ? <Badge tone="neutral">{scopeLabel(data.scope.projectCount)}</Badge> : null}
      </div>

      {report.isError && !data ? (
        <EmptyState
          illustration="search"
          title="We couldn't load these reports"
          description={report.error.message}
          actions={<Button onClick={() => void report.refetch()}>Try again</Button>}
        />
      ) : !data ? (
        <ReportSkeleton />
      ) : data.totals.total === 0 && data.scope.kind === 'portfolio' && projectList.length === 0 ? (
        <EmptyState
          illustration="workspace"
          title="Reports fill in as you work"
          description="Create a project and add a few tasks. Charts update the moment work moves."
          actions={can('project:create') ? <Link href={routes.newProject()}><Button>Create a project</Button></Link> : null}
        />
      ) : (
        <div className={cn('flex flex-col gap-5 transition-opacity duration-[var(--duration-fast)]', report.isPlaceholderData && 'opacity-60')} data-testid="report-body">
          <KpiTiles report={data} />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <BurnPanel report={data} />
            <StatusPanel report={data} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <VelocityPanel report={data} />
            <CycleTimePanel report={data} />
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <WorkloadPanel report={data} personText={personText} />
            <OverduePanel report={data} personText={personText} />
          </div>
          <div className={cn('grid gap-5', data.scope.kind === 'portfolio' && 'lg:grid-cols-2')}>
            {data.scope.kind === 'portfolio' ? <PortfolioProjects projects={portfolioProjects} spaces={spaceById} /> : null}
            <CompletedPanel report={data} taskHref={taskHref} />
          </div>
          {selected ? (
            <p className="text-center text-xs text-fg-muted">
              Owner <PersonAvatar userId={selected.ownerId} size="xs" showName className="align-middle" /> · Reports count top-level tasks; subtasks roll up into their parent.
            </p>
          ) : (
            <p className="text-center text-xs text-fg-muted">Reports count top-level tasks in active projects you can see. Archived projects are left out.</p>
          )}
        </div>
      )}
    </Page>
  );
}
