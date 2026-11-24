'use client';
/**
 * Left navigation: Home, My work, Inbox (unread badge), Projects, Goals, Dashboards, Automations,
 * Templates, starred projects, Spaces with their projects, Settings. Collapses to a 56px icon
 * rail (persisted); below md it renders inside the mobile drawer (variant="drawer").
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarCheck2,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FolderKanban,
  House,
  Inbox,
  ClipboardList,
  LayoutTemplate,
  Plus,
  Settings2,
  Star,
  Target,
  Workflow,
} from 'lucide-react';
import { CountBadge, IconButton, Tooltip, cn } from '@/components/ui';
import { ProjectHealthDot } from '@/features/projects/health';
import { EntityIcon } from '@/components/pm';
import { useProjects, useSpaces, useUnreadCount } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { ProjectSummary, SpaceDTO } from '@/lib/types';
import { useShell } from './shell-context';
import { useShellStore } from './store';

const RAIL_WIDTH = 56;
const SIDEBAR_WIDTH = 252;

const rowClass = [
  'group/row relative flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-base text-fg outline-none',
  'transition-[background-color] duration-[var(--duration-instant)] ease-out',
  'hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
  'aria-[current=page]:bg-selected aria-[current=page]:font-medium aria-[current=page]:text-primary-text aria-[current=page]:hover:bg-selected-hover',
  '[&[aria-current=page]_[data-row-icon]]:text-primary-text',
].join(' ');

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly match: (pathname: string) => boolean;
  readonly badge?: number;
  readonly testId: string;
}

function NavLink({ item, collapsed }: { readonly item: NavItem; readonly collapsed: boolean }) {
  const pathname = usePathname() ?? '/';
  const active = item.match(pathname);
  if (collapsed) {
    return (
      <Tooltip content={item.badge ? `${item.label} (${item.badge} unread)` : item.label} side="right">
        <Link
          href={item.href}
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          data-testid={item.testId}
          className="relative inline-flex size-9 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:bg-selected aria-[current=page]:text-primary-text"
        >
          {item.icon}
          {item.badge ? (
            <span className="absolute -top-0.5 -right-0.5">
              <CountBadge count={item.badge} ringClassName="ring-[var(--surface-app)]" />
            </span>
          ) : null}
        </Link>
      </Tooltip>
    );
  }
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} data-testid={item.testId} className={rowClass}>
      <span data-row-icon className="flex size-5 shrink-0 items-center justify-center text-icon">
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge ? <CountBadge count={item.badge} tone="danger" /> : null}
    </Link>
  );
}

function SectionHeading({ children, action }: { readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <div className="group/heading flex h-7 items-center justify-between pr-1 pl-2">
      <span className="text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{children}</span>
      {action}
    </div>
  );
}

function ProjectRow({ project, depth = 0 }: { readonly project: ProjectSummary; readonly depth?: number }) {
  const pathname = usePathname() ?? '/';
  const href = routes.project(project.key);
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(rowClass, 'h-7 text-sm')}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={project.name}
    >
      <EntityIcon icon={project.icon} color={project.color} size={18} />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      <ProjectHealthDot project={project} hideOnTrack showHint={false} />
    </Link>
  );
}

function SpaceGroup({ space, projects }: { readonly space: SpaceDTO; readonly projects: readonly ProjectSummary[] }) {
  const collapsed = useShellStore((state) => state.collapsedSpaceIds.includes(space.id));
  const toggle = useShellStore((state) => state.toggleSpace);
  return (
    <li>
      <button
        type="button"
        onClick={() => toggle(space.id)}
        aria-expanded={!collapsed}
        className={cn(rowClass, 'h-7 text-sm font-medium text-fg-secondary')}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-icon">
          {collapsed ? <ChevronRight aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
        </span>
        <EntityIcon icon={space.icon} color={space.color} size={16} variant="plain" />
        <span className="min-w-0 flex-1 truncate text-left">{space.name}</span>
        <span className="text-2xs text-fg-muted tabular-nums">{projects.length}</span>
      </button>
      {!collapsed ? (
        <ul className="flex flex-col gap-px">
          {projects.length === 0 ? (
            <li className="py-1 pr-2 pl-9 text-xs text-fg-muted">No projects yet</li>
          ) : (
            projects.map((project) => (
              <li key={project.id}>
                <ProjectRow project={project} depth={1} />
              </li>
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}

export interface SidebarProps {
  readonly variant?: 'docked' | 'drawer';
  readonly initialProjects?: readonly ProjectSummary[];
  readonly initialSpaces?: readonly SpaceDTO[];
  readonly initialUnread?: number;
}

export function Sidebar({ variant = 'docked', initialProjects, initialSpaces, initialUnread }: SidebarProps) {
  const { can } = useShell();
  const storeCollapsed = useShellStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const collapsed = variant === 'docked' && storeCollapsed;
  const projects = useProjects({}, { initialData: initialProjects ? [...initialProjects] : undefined });
  const spaces = useSpaces({ initialData: initialSpaces ? [...initialSpaces] : undefined });
  const unread = useUnreadCount({ initialData: initialUnread !== undefined ? { count: initialUnread } : undefined });
  // The layout re-renders after every server action (revalidatePath); push its fresh data into the cache.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (initialProjects) queryClient.setQueryData(qk.projects(), [...initialProjects]);
  }, [initialProjects, queryClient]);
  useEffect(() => {
    if (initialSpaces) queryClient.setQueryData(qk.spaces(), [...initialSpaces]);
  }, [initialSpaces, queryClient]);
  useEffect(() => {
    if (initialUnread !== undefined) queryClient.setQueryData(qk.unread(), { count: initialUnread });
  }, [initialUnread, queryClient]);

  const primary: NavItem[] = [
    { href: routes.home(), label: 'Home', icon: <House aria-hidden className="size-[18px]" />, match: (p) => p === '/', testId: 'nav-home' },
    { href: routes.myWork(), label: 'My work', icon: <CalendarCheck2 aria-hidden className="size-[18px]" />, match: (p) => p.startsWith('/my-work'), testId: 'nav-my-work' },
    {
      href: routes.inbox(),
      label: 'Inbox',
      icon: <Inbox aria-hidden className="size-[18px]" />,
      match: (p) => p.startsWith('/inbox'),
      badge: unread.data?.count ?? 0,
      testId: 'nav-inbox',
    },
    {
      href: routes.projects(),
      label: 'Projects',
      icon: <FolderKanban aria-hidden className="size-[18px]" />,
      match: (p) => p === '/projects' || p.startsWith('/projects/'),
      testId: 'nav-projects',
    },
  ];
  const secondary: NavItem[] = [
    { href: routes.goals(), label: 'Goals', icon: <Target aria-hidden className="size-[18px]" />, match: (p) => p.startsWith('/goals'), testId: 'nav-goals' },
    { href: routes.dashboards(), label: 'Dashboards', icon: <BarChart3 aria-hidden className="size-[18px]" />, match: (p) => p.startsWith('/dashboards'), testId: 'nav-dashboards' },
    { href: routes.automations(), label: 'Automations', icon: <Workflow aria-hidden className="size-[18px]" />, match: (p) => p.startsWith('/automations'), testId: 'nav-automations' },
    { href: routes.templates(), label: 'Templates', icon: <LayoutTemplate aria-hidden className="size-[18px]" />, match: (p) => p.startsWith('/templates'), testId: 'nav-templates' },
    { href: routes.forms(), label: 'Forms', icon: <ClipboardList aria-hidden className="size-[18px]" />, match: (p) => p === '/forms', testId: 'nav-forms' },
  ];
  const settings: NavItem = {
    href: routes.settings(),
    label: 'Settings',
    icon: <Settings2 aria-hidden className="size-[18px]" />,
    match: (p) => p.startsWith('/settings'),
    testId: 'nav-settings',
  };

  const list = useMemo(() => projects.data ?? [], [projects.data]);
  const starred = list.filter((project) => project.starred);
  const bySpace = useMemo(() => {
    const map = new Map<string | null, ProjectSummary[]>();
    for (const project of list) {
      // The sidebar lists open work; finished projects live under the Completed tab on the Projects page.
      if (project.status === 'completed' || project.status === 'archived') continue;
      const key = project.spaceId;
      map.set(key, [...(map.get(key) ?? []), project]);
    }
    return map;
  }, [list]);
  const ungrouped = bySpace.get(null) ?? [];

  return (
    <nav
      aria-label="Main"
      data-testid="sidebar"
      style={variant === 'docked' ? { width: collapsed ? RAIL_WIDTH : SIDEBAR_WIDTH } : undefined}
      className={cn(
        'flex h-full min-h-0 shrink-0 flex-col bg-app',
        variant === 'docked' && 'border-r border-border-subtle transition-[width] duration-[var(--duration-normal)] ease-out',
      )}
    >
      <div className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3', collapsed ? 'px-2' : 'px-2.5')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            {[...primary, ...secondary].map((item) => (
              <NavLink key={item.href} item={item} collapsed />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-px">
              {primary.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} collapsed={false} />
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-px">
              {secondary.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} collapsed={false} />
                </li>
              ))}
            </ul>
            {starred.length > 0 ? (
              <div>
                <SectionHeading>
                  <span className="inline-flex items-center gap-1">
                    <Star aria-hidden className="size-3" /> Starred
                  </span>
                </SectionHeading>
                <ul className="flex flex-col gap-px">
                  {starred.map((project) => (
                    <li key={project.id}>
                      <ProjectRow project={project} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div data-testid="sidebar-spaces">
              <SectionHeading
                action={
                  can('project:create') ? (
                    <Tooltip content="New project">
                      <Link
                        href={routes.newProject()}
                        aria-label="New project"
                        className="inline-flex size-6 items-center justify-center rounded-sm text-icon opacity-70 hover:bg-hover hover:opacity-100 focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        <Plus aria-hidden className="size-3.5" />
                      </Link>
                    </Tooltip>
                  ) : null
                }
              >
                Spaces
              </SectionHeading>
              <ul className="flex flex-col gap-0.5">
                {(spaces.data ?? []).map((space) => (
                  <SpaceGroup key={space.id} space={space} projects={bySpace.get(space.id) ?? []} />
                ))}
                {ungrouped.length > 0 ? (
                  <SpaceGroup
                    space={{ id: 'ungrouped', name: 'Other projects', description: null, color: 'gray', icon: 'folder', position: 'zzzz', isPrivate: false, archivedAt: null, projectCount: ungrouped.length }}
                    projects={ungrouped}
                  />
                ) : null}
                {list.length === 0 && (spaces.data ?? []).length === 0 && !projects.isLoading ? (
                  <li className="px-2 py-2 text-xs text-fg-muted">
                    No projects yet.{' '}
                    {can('project:create') ? (
                      <Link href={routes.newProject()} className="font-medium text-fg-link hover:underline">
                        Start one
                      </Link>
                    ) : null}
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        )}
      </div>
      <div className={cn('flex shrink-0 items-center gap-1 border-t border-border-subtle py-2', collapsed ? 'flex-col px-2' : 'px-2.5')}>
        {collapsed ? <NavLink item={settings} collapsed /> : <div className="min-w-0 flex-1"><NavLink item={settings} collapsed={false} /></div>}
        {variant === 'docked' ? (
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            shortcut={['[']}
            tooltipSide="right"
            icon={collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
            onClick={toggleSidebar}
            data-testid="sidebar-toggle"
          />
        ) : null}
      </div>
    </nav>
  );
}
