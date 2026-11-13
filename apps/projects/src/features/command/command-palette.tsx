'use client';
/**
 * ⌘/Ctrl+K command palette. Type to:
 *   - find tasks (by words or a key like OPS-42), people and goals (live server search),
 *   - jump to any project, page, or a view of the project you're in,
 *   - create a task (the text becomes a quick-add sentence) or a project,
 *   - switch theme or organization, open CRM / WMS / Portal, sign out.
 * Local commands filter instantly as you type; server results are always shown alongside them.
 * Visual language matches the Portal/CRM palettes (same frame, group headings, row anatomy, footer).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Command, defaultFilter, useCommandState } from 'cmdk';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BarChart3,
  CalendarCheck2,
  CornerDownLeft,
  FolderKanban,
  FolderPlus,
  House,
  Inbox,
  Keyboard,
  ClipboardList,
  LayoutTemplate,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Target,
  TextSearch,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import { DARK_QUERY, persistTheme } from '@kitstak/ui/theme';
import { Avatar, Kbd, Spinner, cn } from '@/components/ui';
import { EntityIcon, StatusIcon } from '@/components/pm';
import { organization, signOut } from '@/lib/auth-client';
import { VIEW_TYPE_LABELS } from '@/lib/constants';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useProjects, useSearch } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { PROJECT_TABS, routes, type ProjectTab } from '@/lib/routes';
import { useShell } from '@/features/shell/shell-context';
import { orgInitials } from '@/features/shell/org-switcher';
import { useShellStore } from '@/features/shell/store';
import { markUsedSearch } from './usage-flags';

const groupClass =
  '[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted';

/** Server results always match (they were searched on the server); everything else uses cmdk's fuzzy score. */
const REMOTE = 'remote:';
function paletteFilter(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith(REMOTE)) return 0.5;
  const score = defaultFilter(value, search, keywords);
  // cmdk keeps anything above 0; drop the loose fuzzy hits ("pallets" → "Templates") so only real
  // matches sit above the task results.
  return score < (search.trim().length >= 3 ? 0.3 : 0.05) ? 0 : score;
}

const TAB_LABEL: Record<ProjectTab, string> = {
  overview: 'Overview',
  ...VIEW_TYPE_LABELS,
  files: 'Files',
  activity: 'Activity',
  settings: 'Settings',
};

function Item({
  value,
  keywords,
  onSelect,
  icon,
  children,
  meta,
  hint,
  external,
  forceMount,
  testId = 'palette-item',
}: {
  readonly value: string;
  readonly keywords?: readonly string[];
  readonly onSelect: () => void;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly meta?: ReactNode;
  readonly hint?: ReactNode;
  readonly external?: boolean;
  readonly forceMount?: boolean;
  readonly testId?: string;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords ? [...keywords] : undefined}
      onSelect={onSelect}
      forceMount={forceMount}
      data-testid={testId}
      className={cn(
        'group/item mx-2 flex cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-fg select-none',
        meta ? 'min-h-12 py-1.5' : 'h-10',
        'data-[selected=true]:bg-hover',
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm text-icon">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {meta ? <span className="truncate text-xs text-fg-muted">{meta}</span> : null}
      </span>
      {hint ? <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">{hint}</span> : null}
      <span aria-hidden className="hidden shrink-0 items-center gap-1 text-fg-muted group-data-[selected=true]/item:flex">
        {external ? <ArrowUpRight className="size-3.5" /> : null}
        <CornerDownLeft className="size-3.5" />
      </span>
    </Command.Item>
  );
}

/** "Nothing matches" only when neither local commands nor server results have anything. */
function PaletteEmpty({ remoteCount, searching, fetching }: { readonly remoteCount: number; readonly searching: boolean; readonly fetching: boolean }) {
  const localCount = useCommandState((state) => state.filtered.count);
  // `filtered.count` only counts rows that matched the text (not the always-shown ones).
  if (!searching || remoteCount > 0 || localCount > 0) return null;
  return (
    <div className="px-6 pt-6 pb-2 text-center text-sm text-fg-muted" role="status">
      {fetching ? 'Searching…' : 'No tasks, projects or people match. Try a task key like OPS-12, or create it below.'}
    </div>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const queryClient = useQueryClient();
  const { openTask } = useTaskDrawer();
  const { org, orgs, appUrls, modules, can } = useShell();
  const open = useShellStore((state) => state.paletteOpen);
  const query = useShellStore((state) => state.paletteQuery);
  const setOpen = useShellStore((state) => state.setPaletteOpen);
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const openShortcuts = useShellStore((state) => state.openShortcuts);
  const setQuery = useCallback((value: string) => useShellStore.setState({ paletteQuery: value }), []);
  const debounced = useDebouncedValue(query.trim(), 150);
  const results = useSearch(debounced, { enabled: open && debounced.length > 0 });
  const projects = useProjects({}, { enabled: open });

  useEffect(() => {
    if (open) markUsedSearch();
  }, [open]);

  const close = useCallback(() => setOpen(false), [setOpen]);
  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );
  const openApp = useCallback(
    (url: string) => {
      close();
      window.open(withThemeParam(url), '_blank', 'noopener');
    },
    [close],
  );
  const switchOrg = useCallback(
    async (orgId: string) => {
      close();
      if (orgId === org.id) return;
      await organization.setActive({ organizationId: orgId });
      queryClient.clear();
      router.push('/');
      router.refresh();
    },
    [close, org.id, queryClient, router],
  );
  const setTheme = useCallback(
    (next: 'light' | 'dark') => {
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      persistTheme(next);
      close();
    },
    [close],
  );
  const currentTheme = () => document.documentElement.dataset.theme ?? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light');
  const onSignOut = useCallback(async () => {
    close();
    await signOut();
    router.replace('/login?notice=signed-out');
    router.refresh();
  }, [close, router]);

  const typing = query.trim().length > 0;
  const searching = debounced.length > 0;
  const allProjects = useMemo(() => (projects.data ?? []).filter((p) => !p.archivedAt), [projects.data]);
  const shownProjects = typing ? allProjects : allProjects.slice(0, 6);
  const currentKey = /^\/p\/([^/?#]+)/.exec(pathname)?.[1];
  const currentProject = currentKey ? allProjects.find((p) => p.key === decodeURIComponent(currentKey).toUpperCase()) : undefined;
  const remote = searching ? results.data : undefined;
  const remoteCount = (remote?.tasks.length ?? 0) + (remote?.people.length ?? 0) + (remote?.goals.length ?? 0);

  const pages: { value: string; label: string; href: string; icon: LucideIcon; keywords: string[]; chord?: string }[] = [
    { value: 'home', label: 'Home', href: routes.home(), icon: House, keywords: ['dashboard', 'start', 'today'], chord: 'H' },
    { value: 'my-work', label: 'My work', href: routes.myWork(), icon: CalendarCheck2, keywords: ['my tasks', 'assigned', 'todo'], chord: 'M' },
    { value: 'inbox', label: 'Inbox', href: routes.inbox(), icon: Inbox, keywords: ['notifications', 'mentions'], chord: 'I' },
    { value: 'search', label: 'Search', href: routes.search(), icon: TextSearch, keywords: ['find', 'comments'], chord: 'S' },
    { value: 'projects', label: 'Projects', href: routes.projects(), icon: FolderKanban, keywords: ['portfolio', 'all projects'], chord: 'P' },
    { value: 'goals', label: 'Goals', href: routes.goals(), icon: Target, keywords: ['okr', 'objectives'], chord: 'G' },
    { value: 'dashboards', label: 'Dashboards', href: routes.dashboards(), icon: BarChart3, keywords: ['reports', 'charts'] },
    { value: 'automations', label: 'Automations', href: routes.automations(), icon: Workflow, keywords: ['rules', 'when then'] },
    { value: 'templates', label: 'Templates', href: routes.templates(), icon: LayoutTemplate, keywords: ['blueprints'] },
    { value: 'forms', label: 'Forms', href: routes.forms(), icon: ClipboardList, keywords: ['intake', 'request form', 'survey'] },
    { value: 'settings', label: 'Settings', href: routes.settings(), icon: Settings2, keywords: ['preferences', 'workspace'] },
  ];

  /** Does a page, project or project view match the text well? Then it stays the highlighted row. */
  const localMatch = (text: string) => {
    const candidates: [string, string[]][] = [
      ...pages.map((p): [string, string[]] => [`go-${p.value}`, [p.label, ...p.keywords]]),
      ...allProjects.map((p): [string, string[]] => [`project-${p.key}`, [p.name, p.key]]),
      ...(currentProject ? PROJECT_TABS.map((tab): [string, string[]] => [`tab-${tab}`, [TAB_LABEL[tab]]]) : []),
    ];
    return candidates.some(([value, keywords]) => paletteFilter(value, text, keywords) >= 0.6);
  };

  // Highlighted row. When task results arrive for a new search, put the first task under Enter.
  const [selected, setSelected] = useState('');
  const remoteKey = remote ? `${debounced}:${remote.tasks[0]?.id ?? ''}` : '';
  const [seenRemoteKey, setSeenRemoteKey] = useState('');
  if (remoteKey !== seenRemoteKey) {
    setSeenRemoteKey(remoteKey);
    const first = remote?.tasks[0];
    if (first && debounced === query.trim() && !localMatch(debounced)) setSelected(`${REMOTE}task-${first.id}`);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search and commands"
      filter={paletteFilter}
      value={selected}
      onValueChange={setSelected}
      loop
      overlayClassName="fixed inset-0 z-[var(--z-modal)] bg-overlay/60 data-[state=open]:animate-fade-in"
      contentClassName={cn(
        'fixed top-[10vh] left-1/2 z-[var(--z-modal)] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden',
        'rounded-xl border border-border-subtle bg-raised shadow-modal outline-none data-[state=open]:animate-pop-in',
      )}
      className="flex max-h-[min(560px,76vh)] flex-col"
    >
      <div className="flex items-center gap-3 border-b border-border-subtle px-4">
        <Search aria-hidden className="size-5 shrink-0 text-icon" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search tasks, projects and people, or type a command…"
          className="h-13 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-placeholder"
          data-testid="palette-input"
        />
        {results.isFetching && searching ? <Spinner size="xs" label={null} /> : <Kbd>Esc</Kbd>}
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto pb-2">
        <PaletteEmpty remoteCount={remoteCount} searching={searching} fetching={results.isFetching} />



        {typing ? null : (
          <Command.Group heading="Create" className={groupClass}>
            <Item value="new-task" keywords={['create', 'add', 'task', 'todo']} onSelect={() => openQuickAdd()} icon={<Plus aria-hidden className="size-4" />} hint={<Kbd>C</Kbd>}>
              New task
            </Item>
            {can('project:create') ? (
              <Item value="new-project" keywords={['create', 'project', 'template']} onSelect={() => go(routes.newProject())} icon={<FolderPlus aria-hidden className="size-4" />}>
                New project
              </Item>
            ) : null}
          </Command.Group>
        )}

        {currentProject ? (
          <Command.Group heading={`In ${currentProject.name}`} className={groupClass}>
            {PROJECT_TABS.filter((tab) => tab !== 'settings' || currentProject.role === 'owner' || currentProject.role === 'editor').map((tab) => (
              <Item
                key={tab}
                value={`tab-${tab}`}
                keywords={[TAB_LABEL[tab], 'view', currentProject.key]}
                onSelect={() => go(routes.projectTab(currentProject.key, tab))}
                icon={<EntityIcon icon={currentProject.icon} color={currentProject.color} size={20} />}
              >
                {TAB_LABEL[tab]}
              </Item>
            ))}
            {typing ? null : (
              <Item value="new-task-here" keywords={['add', 'create', 'task']} onSelect={() => openQuickAdd({ projectId: currentProject.id })} icon={<Plus aria-hidden className="size-4" />} meta={currentProject.name}>
                New task in this project
              </Item>
            )}
          </Command.Group>
        ) : null}

        {shownProjects.length ? (
          <Command.Group heading={typing ? 'Projects' : 'Jump to a project'} className={groupClass}>
            {shownProjects.map((project) => (
              <Item
                key={project.id}
                value={`project-${project.key}`}
                keywords={[project.name, project.key]}
                onSelect={() => go(routes.project(project.key))}
                icon={<EntityIcon icon={project.icon} color={project.color} size={22} />}
                meta={project.key}
                testId="palette-project"
              >
                {project.name}
              </Item>
            ))}
          </Command.Group>
        ) : null}

        <Command.Group heading="Go to" className={groupClass}>
          {pages.map((entry) => (
            <Item
              key={entry.value}
              value={`go-${entry.value}`}
              keywords={[entry.label, ...entry.keywords]}
              onSelect={() => go(entry.href)}
              icon={<entry.icon aria-hidden className="size-4" />}
              hint={
                entry.chord ? (
                  <>
                    <Kbd>G</Kbd>
                    <Kbd>{entry.chord}</Kbd>
                  </>
                ) : undefined
              }
            >
              {entry.label}
            </Item>
          ))}
        </Command.Group>

        {remote?.tasks.length ? (
          <Command.Group heading="Tasks" className={groupClass} forceMount>
            {remote.tasks.map((task) => (
              <Item
                key={task.id}
                value={`${REMOTE}task-${task.id}`}
                forceMount
                testId="palette-task"
                onSelect={() => {
                  close();
                  openTask(task.key);
                }}
                icon={<StatusIcon category={task.statusCategory} />}
                meta={`${task.key} · ${task.projectName}`}
              >
                {task.title}
              </Item>
            ))}
          </Command.Group>
        ) : null}

        {typing ? (
          <Command.Group heading="Create" className={groupClass} forceMount>
            <Item value={`${REMOTE}create-task`} forceMount onSelect={() => openQuickAdd({ text: query.trim() })} icon={<Plus aria-hidden className="size-4" />} meta="Dates, !priority, @people and #labels are filled in for you" testId="palette-create-task">
              New task “{query.trim()}”
            </Item>
            <Item value={`${REMOTE}search-all`} forceMount onSelect={() => go(routes.search(query.trim()))} icon={<TextSearch aria-hidden className="size-4" />} meta="Tasks, comments, projects, people and goals" testId="palette-search-all">
              Search everything for “{query.trim()}”
            </Item>
          </Command.Group>
        ) : null}

        {remote?.people.length ? (
          <Command.Group heading="People" className={groupClass} forceMount>
            {remote.people.map((person) => (
              <Item
                key={person.id}
                value={`${REMOTE}person-${person.id}`}
                forceMount
                onSelect={() => go(`${routes.search()}?type=tasks&assignee=${person.id}&status=open`)}
                icon={<Avatar name={person.name} src={person.image} size="xs" />}
                meta={`${person.email} · see their open tasks`}
              >
                {person.name}
              </Item>
            ))}
          </Command.Group>
        ) : null}

        {remote?.goals.length ? (
          <Command.Group heading="Goals" className={groupClass} forceMount>
            {remote.goals.map((goal) => (
              <Item key={goal.id} value={`${REMOTE}goal-${goal.id}`} forceMount onSelect={() => go(routes.goal(goal.id))} icon={<Target aria-hidden className="size-4" />}>
                {goal.name}
              </Item>
            ))}
          </Command.Group>
        ) : null}


        {orgs.length > 1 ? (
          <Command.Group heading="Switch organization" className={groupClass}>
            {orgs.map((entry) => (
              <Item
                key={entry.id}
                value={`org-${entry.slug}`}
                keywords={['switch', 'organization', 'workspace', entry.name]}
                onSelect={() => void switchOrg(entry.id)}
                icon={<span className="inline-flex size-6 items-center justify-center rounded-sm bg-sunken text-2xs font-bold text-fg-secondary">{orgInitials(entry.name)}</span>}
                meta={<span className="capitalize">{entry.role}</span>}
                hint={entry.id === org.id ? 'Current' : undefined}
              >
                {entry.name}
              </Item>
            ))}
          </Command.Group>
        ) : null}

        <Command.Group heading="KitStak apps" className={groupClass}>
          <Item value="open-portal" keywords={['portal', 'launcher', 'billing', 'apps']} onSelect={() => openApp(appUrls.portal)} icon={<ArrowUpRight aria-hidden className="size-4" />} meta="Launcher, billing and your team" external>
            Open Portal
          </Item>
          {modules.crm ? (
            <Item value="open-crm" keywords={['crm', 'deals', 'sales', 'customers']} onSelect={() => openApp(`${appUrls.crm}/${org.slug}`)} icon={<ArrowUpRight aria-hidden className="size-4" />} meta="Deals, accounts and pipelines" external>
              Open CRM
            </Item>
          ) : null}
          {modules.wms ? (
            <Item value="open-wms" keywords={['wms', 'warehouse', 'orders', 'inventory']} onSelect={() => openApp(appUrls.wms)} icon={<ArrowUpRight aria-hidden className="size-4" />} meta="Orders, inventory and receiving" external>
              Open WMS
            </Item>
          ) : null}
        </Command.Group>

        <Command.Group heading="Preferences" className={groupClass}>
          <Item value="theme-dark" keywords={['dark', 'theme', 'night', 'mode']} onSelect={() => setTheme('dark')} icon={<Moon aria-hidden className="size-4" />} hint={typeof document !== 'undefined' && currentTheme() === 'dark' ? 'On' : undefined}>
            Dark mode
          </Item>
          <Item value="theme-light" keywords={['light', 'theme', 'day', 'mode']} onSelect={() => setTheme('light')} icon={<Sun aria-hidden className="size-4" />} hint={typeof document !== 'undefined' && currentTheme() === 'light' ? 'On' : undefined}>
            Light mode
          </Item>
          <Item
            value="shortcuts"
            keywords={['keyboard', 'shortcuts', 'help', 'keys']}
            onSelect={() => {
              close();
              openShortcuts();
            }}
            icon={<Keyboard aria-hidden className="size-4" />}
            hint={<Kbd>?</Kbd>}
          >
            Keyboard shortcuts
          </Item>
          <Item value="sign-out" keywords={['log out', 'logout', 'sign out', 'exit']} onSelect={() => void onSignOut()} icon={<LogOut aria-hidden className="size-4" />}>
            Sign out
          </Item>
        </Command.Group>
      </Command.List>
      <div className="hidden items-center gap-4 border-t border-border-subtle bg-sunken px-4 py-2 text-xs text-fg-muted sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-1">
          Type <Kbd>OPS-12</Kbd> to jump to a task
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd>Esc</Kbd> close
        </span>
      </div>
    </Command.Dialog>
  );
}
