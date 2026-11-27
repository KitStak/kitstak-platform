'use client';
/**
 * Home sections beside My tasks: inbox preview, goals snapshot and recent projects. Each is a
 * shared DashSection with one header action; progress is a Meter in the app's data color (the
 * health pill already says the state).
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { DashSection, EmptyNote, Meter, Pill, type PillTone } from '@kitstak/ui/dashboard';
import { EntityIcon } from '@/components/pm';
import { GOAL_HEALTH_LABELS, type GoalHealth } from '@/lib/constants';
import { ProjectHealthMark } from '@/features/projects/health';
import { formatRelative } from '@/lib/dates';
import { useRecents } from '@/lib/hooks/use-data';
import { useHydrated } from '@/features/programs/kit/use-hydrated';
import { routes } from '@/lib/routes';
import type { GoalDTO, NotificationDTO, ProjectSummary } from '@/lib/types';
import { useShell } from '@/features/shell/shell-context';
import { NotificationAvatar } from '@/features/inbox/notification-avatar';
import { useInboxActions } from '@/features/inbox/use-inbox-actions';

const ROW = 'rounded-md px-2 py-2 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-focus';

export function InboxPreview({ items, unread }: { readonly items: readonly NotificationDTO[]; readonly unread: number }) {
  const { open } = useInboxActions();
  return (
    <DashSection
      title="Inbox"
      description={unread ? `${unread} unread` : undefined}
      action={{ label: 'Open inbox', href: routes.inbox() }}
      flush
      data-testid="home-inbox"
    >
      {items.length === 0 ? (
        <EmptyNote action={{ label: 'Open My work', href: routes.myWork() }}>You’re all caught up. New work assigned to you lands in My work.</EmptyNote>
      ) : (
        <ul className="flex flex-col p-2">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open(item)} className={`flex w-full items-start gap-2.5 text-left ${ROW}`}>
                <NotificationAvatar item={item} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 text-sm font-medium text-fg">{item.title}</span>
                  {item.body ? <span className="truncate text-xs text-fg-muted">{item.body}</span> : null}
                  <span className="text-xs text-fg-muted" suppressHydrationWarning>
                    {formatRelative(item.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DashSection>
  );
}

const GOAL_PILL_TONE: Readonly<Record<GoalHealth, PillTone>> = {
  on_track: 'positive',
  at_risk: 'caution',
  off_track: 'critical',
  achieved: 'positive',
  missed: 'critical',
};

export function GoalsSnapshot({ goals }: { readonly goals: readonly GoalDTO[] }) {
  const { user } = useShell();
  const top = useMemo(() => {
    const roots = goals.filter((goal) => !goal.parentGoalId);
    const mine = roots.filter((goal) => goal.ownerId === user.id);
    return [...mine, ...roots.filter((goal) => goal.ownerId !== user.id)].slice(0, 4);
  }, [goals, user.id]);
  return (
    <DashSection title="Goals" action={{ label: 'All goals', href: routes.goals() }} flush data-testid="home-goals">
      {top.length === 0 ? (
        <EmptyNote action={{ label: 'Set your first goal', href: routes.goals() }}>No goals yet. A goal ties projects to the result they are for.</EmptyNote>
      ) : (
        <ul className="flex flex-col p-2">
          {top.map((goal) => (
            <li key={goal.id}>
              <Link href={routes.goal(goal.id)} className={`flex flex-col gap-1.5 ${ROW}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{goal.name}</span>
                  <Pill tone={GOAL_PILL_TONE[goal.health]}>{GOAL_HEALTH_LABELS[goal.health]}</Pill>
                </span>
                <span className="flex items-center gap-2">
                  <Meter value={goal.progress / 100} label={`${goal.name}: ${Math.round(goal.progress)}%`} className="flex-1" />
                  <span className="w-9 text-right text-xs text-fg-muted tabular-nums">{Math.round(goal.progress)}%</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashSection>
  );
}

export function RecentProjects({ projects }: { readonly projects: readonly ProjectSummary[] }) {
  const { can } = useShell();
  const recents = useRecents({ staleTime: 60_000 });
  // The server renders from the projects snapshot alone; visit order applies after hydration so both renders match.
  const hydrated = useHydrated();
  const recentData = hydrated ? recents.data : undefined;
  const ordered = useMemo(() => {
    const visited = new Map<string, string>();
    for (const entry of recentData ?? []) if (entry.entityType === 'project') visited.set(entry.entityId, entry.visitedAt);
    return [...projects]
      .filter((p) => !p.archivedAt)
      .sort((a, b) => {
        const va = visited.get(a.id);
        const vb = visited.get(b.id);
        if (va || vb) return (vb ?? '').localeCompare(va ?? '');
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, 5);
  }, [projects, recentData]);
  return (
    <DashSection title="Recent projects" action={{ label: 'All projects', href: routes.projects() }} flush data-testid="home-projects">
      {ordered.length === 0 ? (
        <EmptyNote action={can('project:create') ? { label: 'Start one from a template', href: routes.newProject() } : null}>
          {can('project:create') ? 'No projects yet.' : 'No projects yet. Ask an admin to add you to one.'}
        </EmptyNote>
      ) : (
        <ul className="flex flex-col p-2">
          {ordered.map((project) => (
            <li key={project.id}>
              <Link href={routes.project(project.key)} className={`flex items-center gap-3 ${ROW}`}>
                <EntityIcon icon={project.icon} color={project.color} size={28} />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{project.name}</span>
                    <ProjectHealthMark project={project} />
                  </span>
                  <Meter value={project.progress.percent / 100} label={`${project.name}: ${project.progress.percent}% of tasks done`} />
                </span>
                <span className="w-9 self-end text-right text-xs text-fg-muted tabular-nums">{project.progress.percent}%</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashSection>
  );
}
