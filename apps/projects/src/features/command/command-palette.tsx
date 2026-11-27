'use client';
/**
 * ⌘/Ctrl+K command palette. Type to:
 *   - find tasks and builds (by words or a key like OPS-42), programs, people and goals (live server search),
 *   - jump to a program, log output or plan builds (a program picker first), Floor today,
 *   - jump to any project, page, or a view of the project you're in,
 *   - create a task (the text becomes a quick-add sentence) or a project,
 *   - switch theme or organization, open CRM / WMS / Portal, sign out.
 * Local commands filter instantly as you type; server results are always shown alongside them.
 * Visual language matches the Portal/CRM palettes (same frame, group headings, row anatomy, footer).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Command, useCommandState } from 'cmdk';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BarChart3,
  CalendarCheck2,
  FolderKanban,
  FolderPlus,
  House,
  Inbox,
  Factory,
  Keyboard,
  Repeat2,
  ClipboardList,
  LayoutTemplate,
  ListChecks,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Target,
  TextSearch,
  Trash2,
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
import { useProgram, usePrograms } from '@/lib/hooks/use-programs';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { PROJECT_TABS, routes, type ProjectTab } from '@/lib/routes';
import { useShell } from '@/features/shell/shell-context';
import { orgInitials } from '@/features/shell/org-switcher';
import { useShellStore } from '@/features/shell/store';
import { markUsedSearch } from './usage-flags';
import { useSelectionCommands } from './selection-commands';
import { Item, REMOTE, groupClass, paletteFilter } from './palette-item';
import { ProgramCreateItems, ProgramPickerGroup, ProgramWorkspaceGroup, ProgramsGroup, RemoteProgramsGroup, programCreateLive, programKeyFromPath, type ProgramPick } from './program-commands';
import { programPageLive } from '@/features/programs/kit/live-pages';

const TAB_LABEL: Record<ProjectTab, string> = {
  overview: 'Overview',
  ...VIEW_TYPE_LABELS,
  files: 'Files',
  activity: 'Activity',
  settings: 'Settings',
};

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
  const programs = usePrograms({}, { enabled: open, staleTime: 60_000 });
  const programKey = programKeyFromPath(pathname);
  const currentProgram = useProgram(programKey ?? '', { enabled: open && programKey !== null, staleTime: 30_000 });
  const [pick, setPick] = useState<ProgramPick | null>(null);
  const selectionHeading = useSelectionCommands((state) => state.heading);
  const selectionCommands = useSelectionCommands((state) => state.commands);

  useEffect(() => {
    if (open) markUsedSearch();
  }, [open]);

  const close = useCallback(() => {
    setPick(null);
    setOpen(false);
  }, [setOpen]);
  const newBuild = useCallback(() => {
    setPick(null);
    openQuickAdd({ mode: 'build', projectId: programKey && currentProgram.data ? currentProgram.data.id : undefined });
  }, [openQuickAdd, programKey, currentProgram.data]);
  const startPick = useCallback(
    (next: ProgramPick) => {
      setPick(next);
      setQuery('');
    },
    [setQuery],
  );
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
  const remoteCount = (remote?.tasks.length ?? 0) + (remote?.people.length ?? 0) + (remote?.goals.length ?? 0) + (remote?.programs?.length ?? 0);
  const allPrograms = useMemo(() => (programs.data ?? []).filter((p) => !p.archivedAt), [programs.data]);
  const programKeys = useMemo(() => new Set(allPrograms.map((p) => p.key)), [allPrograms]);
  const inProgram = programKey && currentProgram.data?.key === programKey ? currentProgram.data : null;

  const pages: { value: string; label: string; href: string; icon: LucideIcon; keywords: string[]; chord?: string }[] = [
    { value: 'home', label: 'Home', href: routes.home(), icon: House, keywords: ['dashboard', 'start', 'today'], chord: 'H' },
    { value: 'my-work', label: 'My work', href: routes.myWork(), icon: CalendarCheck2, keywords: ['my tasks', 'assigned', 'todo'], chord: 'M' },
    { value: 'inbox', label: 'Inbox', href: routes.inbox(), icon: Inbox, keywords: ['notifications', 'mentions'], chord: 'I' },
    { value: 'search', label: 'Search', href: routes.search(), icon: TextSearch, keywords: ['find', 'comments'], chord: 'S' },
    { value: 'projects', label: 'Projects', href: routes.projects(), icon: FolderKanban, keywords: ['portfolio', 'all projects'], chord: 'P' },
    ...(programPageLive('directory') ? [{ value: 'programs', label: 'Programs', href: routes.programs(), icon: Repeat2, keywords: ['program', 'recurring', 'kitting', 'repeat work'], chord: 'R' }] : []),
    ...(programPageLive('floor') ? [{ value: 'floor-today-page', label: 'Floor today', href: routes.programsToday(), icon: Factory, keywords: ['floor', 'today', 'runs', 'production'], chord: 'F' }] : []),
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
      ...allPrograms.map((p): [string, string[]] => [`program-${p.key}`, [p.name, p.key]]),
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
      onOpenChange={(next) => {
        if (!next) setPick(null);
        setOpen(next);
      }}
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
          onKeyDown={(event) => {
            if (pick && event.key === 'Backspace' && query === '') {
              event.preventDefault();
              setPick(null);
            }
          }}
          placeholder={pick ? 'Type a program name or key' : 'Search tasks, projects, programs and people, or type a command…'}
          className="h-13 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-placeholder"
          data-testid="palette-input"
        />
        {results.isFetching && searching ? <Spinner size="xs" label={null} /> : <Kbd>Esc</Kbd>}
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto pb-2">
        {pick ? <ProgramPickerGroup pick={pick} programs={allPrograms} go={go} onBack={() => setPick(null)} /> : null}
        {pick ? null : (
        <>
        <PaletteEmpty remoteCount={remoteCount} searching={searching} fetching={results.isFetching} />



        {selectionHeading && selectionCommands.length ? (
          <Command.Group heading={selectionHeading} className={groupClass} data-testid="palette-selection">
            {selectionCommands.map((command) => (
              <Item
                key={command.id}
                value={`selection-${command.id} ${command.label}`}
                keywords={command.keywords}
                onSelect={() => {
                  close();
                  command.run();
                }}
                icon={command.danger ? <Trash2 aria-hidden className="size-4 text-danger" /> : <ListChecks aria-hidden className="size-4" />}
                testId="palette-selection-item"
              >
                {command.label}
              </Item>
            ))}
          </Command.Group>
        ) : null}

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
            <ProgramCreateItems canCreate={can('project:create')} hasPrograms={allPrograms.length > 0} go={go} onNewBuild={newBuild} onPick={startPick} />
          </Command.Group>
        )}

        {typing && programCreateLive(can('project:create'), allPrograms.length > 0 && !inProgram) ? (
          <Command.Group heading="Program commands" className={groupClass}>
            <ProgramCreateItems canCreate={can('project:create')} hasPrograms={allPrograms.length > 0 && !inProgram} go={go} onNewBuild={newBuild} onPick={startPick} />
          </Command.Group>
        ) : null}

        {inProgram ? <ProgramWorkspaceGroup program={inProgram} typing={typing} go={go} onNewBuild={newBuild} /> : null}

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

        <ProgramsGroup programs={allPrograms} typing={typing} go={go} />

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
                hint={task.kind === 'build' ? <span className="rounded-sm bg-info-subtle px-1.5 py-px text-2xs font-semibold text-info-text">Build</span> : undefined}
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
            <Item value={`${REMOTE}search-all`} forceMount onSelect={() => go(routes.search(query.trim()))} icon={<TextSearch aria-hidden className="size-4" />} meta="Tasks, comments, projects, programs, people and goals" testId="palette-search-all">
              Search everything for “{query.trim()}”
            </Item>
          </Command.Group>
        ) : null}

        {remote?.programs?.length ? <RemoteProgramsGroup hits={remote.programs} known={typing ? programKeys : new Set()} go={go} /> : null}

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
        </>
        )}
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
