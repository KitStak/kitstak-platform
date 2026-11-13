'use client';
/** Home right rail: inbox preview, goals snapshot and recent projects. */
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { ArrowRight, FolderPlus, Inbox, Target } from 'lucide-react';
import { ProgressBar, cn } from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { GOAL_HEALTH_LABELS, type GoalHealth, type ProjectHealth } from '@/lib/constants';
import { healthProgressTone } from '@/lib/health';
import { ProjectHealthMark } from '@/features/projects/health';
import { formatRelative } from '@/lib/dates';
import { useRecents } from '@/lib/hooks/use-data';
import { routes } from '@/lib/routes';
import type { GoalDTO, NotificationDTO, ProjectSummary } from '@/lib/types';
import { useShell } from '@/features/shell/shell-context';
import { NotificationAvatar } from '@/features/inbox/notification-avatar';
import { useInboxActions } from '@/features/inbox/use-inbox-actions';

function RailCard({ title, count, href, linkLabel, children, testId }: { readonly title: string; readonly count?: number; readonly href: string; readonly linkLabel: string; readonly children: ReactNode; readonly testId: string }) {
  return (
    <section className="rounded-xl border border-border-subtle bg-panel shadow-xs" data-testid={testId} aria-label={title}>
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
          {title}
          {count ? <span className="rounded-full bg-primary px-1.5 text-xs leading-5 font-semibold text-primary-fg tabular-nums">{count}</span> : null}
        </h2>
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-fg-link hover:underline">
          {linkLabel} <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </header>
      <div className="p-2">{children}</div>
    </section>
  );
}

export function InboxPreview({ items, unread }: { readonly items: readonly NotificationDTO[]; readonly unread: number }) {
  const { open } = useInboxActions();
  return (
    <RailCard title="Inbox" count={unread} href={routes.inbox()} linkLabel="Open inbox" testId="home-inbox">
      {items.length === 0 ? (
        <p className="flex items-center gap-2 px-2 py-3 text-sm text-fg-muted">
          <Inbox aria-hidden className="size-4" /> You’re all caught up.
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open(item)} className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-focus">
                <NotificationAvatar item={item} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 text-sm font-medium text-fg">{item.title}</span>
                  {item.body ? <span className="truncate text-xs text-fg-muted">{item.body}</span> : null}
                  <span className="text-xs text-fg-muted" suppressHydrationWarning>
                    {formatRelative(item.createdAt)}
                  </span>
                </span>
                <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

const HEALTH_DOT: Record<ProjectHealth | GoalHealth, string> = {
  on_track: 'bg-success',
  at_risk: 'bg-warning-accent',
  off_track: 'bg-danger',
  achieved: 'bg-success',
  missed: 'bg-danger',
};

export function GoalsSnapshot({ goals }: { readonly goals: readonly GoalDTO[] }) {
  const { user } = useShell();
  const top = useMemo(() => {
    const roots = goals.filter((goal) => !goal.parentGoalId);
    const mine = roots.filter((goal) => goal.ownerId === user.id);
    return [...mine, ...roots.filter((goal) => goal.ownerId !== user.id)].slice(0, 4);
  }, [goals, user.id]);
  return (
    <RailCard title="Goals" href={routes.goals()} linkLabel="All goals" testId="home-goals">
      {top.length === 0 ? (
        <div className="flex items-start gap-3 px-2 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-icon">
            <Target aria-hidden className="size-4" />
          </span>
          <p className="text-sm text-fg-muted">
            Goals show how projects add up to the big picture.{' '}
            <Link href={routes.goals()} className="font-medium text-fg-link hover:underline">
              Set your first goal
            </Link>
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {top.map((goal) => (
            <li key={goal.id}>
              <Link href={routes.goal(goal.id)} className="flex flex-col gap-1.5 rounded-md px-2 py-2 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-focus">
                <span className="flex items-center gap-2">
                  <span aria-hidden className={cn('size-2 shrink-0 rounded-full', HEALTH_DOT[goal.health])} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{goal.name}</span>
                  <span className="text-xs text-fg-muted tabular-nums">{Math.round(goal.progress)}%</span>
                </span>
                <ProgressBar value={goal.progress} size="sm" tone={healthProgressTone(goal.health)} label={`${goal.name}: ${Math.round(goal.progress)}%, ${GOAL_HEALTH_LABELS[goal.health]}`} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

export function RecentProjects({ projects }: { readonly projects: readonly ProjectSummary[] }) {
  const { can } = useShell();
  const recents = useRecents({ staleTime: 60_000 });
  const ordered = useMemo(() => {
    const visited = new Map<string, string>();
    for (const entry of recents.data ?? []) if (entry.entityType === 'project') visited.set(entry.entityId, entry.visitedAt);
    return [...projects]
      .filter((p) => !p.archivedAt)
      .sort((a, b) => {
        const va = visited.get(a.id);
        const vb = visited.get(b.id);
        if (va || vb) return (vb ?? '').localeCompare(va ?? '');
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, 5);
  }, [projects, recents.data]);
  return (
    <RailCard title="Recent projects" href={routes.projects()} linkLabel="All projects" testId="home-projects">
      {ordered.length === 0 ? (
        <div className="flex items-start gap-3 px-2 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-icon">
            <FolderPlus aria-hidden className="size-4" />
          </span>
          <p className="text-sm text-fg-muted">
            No projects yet.{' '}
            {can('project:create') ? (
              <Link href={routes.newProject()} className="font-medium text-fg-link hover:underline">
                Start one from a template
              </Link>
            ) : (
              'Ask an admin to add you to one.'
            )}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {ordered.map((project) => (
            <li key={project.id}>
              <Link href={routes.project(project.key)} className="flex items-center gap-3 rounded-md px-2 py-2 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-focus">
                <EntityIcon icon={project.icon} color={project.color} size={28} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">{project.name}</span>
                    <ProjectHealthMark project={project} />
                  </span>
                  <ProgressBar value={project.progress.percent} size="sm" tone={healthProgressTone(project.health)} label={`${project.name} progress`} />
                </span>
                <span className="w-9 text-right text-xs text-fg-muted tabular-nums">{project.progress.percent}%</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}
