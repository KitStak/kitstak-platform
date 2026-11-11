'use client';
/**
 * Global ⌘/Ctrl+K palette. Empty query: Recent + Go to + Actions. With a query (debounced
 * 160ms): Items (board › group breadcrumb, status pill), Boards, Dashboards, People and
 * Workspaces from `/shell/search`, plus matching navigation and actions. Matching is strict
 * (every word must appear) and highlighted. Enter opens, Ctrl/⌘+Enter opens in a new tab.
 * Keys typed before the input has focus (right after ⌘K) are buffered, never dropped.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import {
  ArrowLeft,
  Building2,
  CalendarCheck2,
  Contact,
  CopyCheck,
  Gauge,
  Handshake,
  LayoutDashboard,
  PhoneCall,
  Settings,
  ShieldCheck,
  Trash2,
  Workflow,
  ChevronRight,
  Clock,
  CornerDownLeft,
  ExternalLink,
  House,
  Inbox,
  Keyboard,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Sun,
  Upload,
  UserPlus,
} from 'lucide-react';
import { Avatar, Illustration, Kbd, Skeleton, StatusPill, cn, toLabelColor } from '@/components/ui';
import { useCrmBoards } from '@/features/crm/api';
import { useRecents } from '@/lib/hooks';
import {
  filterToQuery,
  matchScore,
  matchesStrictly,
  orderPaletteGroups,
  pickEnterTarget,
  type PaletteGroup,
} from '@/server/services/shell-search-model';
import { usePaletteSearch, useWorkspaces, type PaletteSearchDto } from './api';
import { DEFAULT_NAV_IDS, buildNavCommands, type NavIconKey } from './nav-registry';
import { EntityIcon } from './entity-icon';
import { HighlightText } from './highlight';
import { useCan, useOrg } from './org-context';
import { entityHref, routes } from './routes';
import { startRouteProgress } from './route-progress';
import { useShellStore } from './store';
import { useTheme } from './theme';
import { WorkspaceTile } from './sidebar/workspace-switcher';

const DEBOUNCE_MS = 160;
const RECENT_LIMIT = 6;
const GROUP_LIMIT = 6;
const EXPANDED_LIMIT = 50;
const GROUP_LABEL: Record<PaletteGroup, string> = {
  items: 'items',
  boards: 'boards',
  dashboards: 'dashboards',
  people: 'people',
  workspaces: 'workspaces',
};

const groupClass =
  '[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted';

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

interface Entry {
  readonly value: string;
  /** Navigation target (enables Ctrl/⌘+Enter → new tab). */
  readonly href?: string;
  readonly run: () => void;
}

function PaletteItem({
  value,
  onSelect,
  icon,
  children,
  meta,
  hint,
  external,
  testId = 'palette-item',
  muted = false,
}: {
  readonly testId?: string;
  /** Secondary row style ("See all"). */
  readonly muted?: boolean;
  readonly value: string;
  readonly onSelect: () => void;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  /** Second line (breadcrumb, email…). */
  readonly meta?: ReactNode;
  /** Right-aligned content (status pill, shortcut). */
  readonly hint?: ReactNode;
  readonly external?: boolean;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      data-testid={testId}
      className={cn(
        'ks-menu-item group/item mx-2 gap-3 rounded-md',
        meta ? 'min-h-12 py-1.5' : 'h-10',
        muted && 'text-primary-text',
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm text-icon">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {meta ? <span className="flex min-w-0 items-center gap-1 truncate text-xs text-fg-muted">{meta}</span> : null}
      </span>
      {hint ? <span className="flex shrink-0 items-center text-xs text-fg-muted">{hint}</span> : null}
      <span
        aria-hidden
        className="hidden shrink-0 items-center gap-1 text-fg-muted group-data-[selected=true]/item:flex"
      >
        {external ? <ExternalLink className="!size-3.5" /> : null}
        <CornerDownLeft className="!size-3.5" />
      </span>
    </Command.Item>
  );
}

function ResultSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-4 py-3" data-skeleton aria-hidden>
      <Skeleton width={72} height={10} className="mb-2" />
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex h-12 items-center gap-3">
          <Skeleton width={28} height={28} rounded="md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton width={`${60 - row * 8}%`} height={12} />
            <Skeleton width={`${34 + row * 6}%`} height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

const NAV_ICON: Record<NavIconKey, ReactNode> = {
  home: <House aria-hidden className="size-4" />,
  mywork: <CalendarCheck2 aria-hidden className="size-4" />,
  inbox: <Inbox aria-hidden className="size-4" />,
  pipeline: <Gauge aria-hidden className="size-4" />,
  deals: <Handshake aria-hidden className="size-4" />,
  leads: <UserPlus aria-hidden className="size-4" />,
  contacts: <Contact aria-hidden className="size-4" />,
  accounts: <Building2 aria-hidden className="size-4" />,
  activities: <PhoneCall aria-hidden className="size-4" />,
  duplicates: <CopyCheck aria-hidden className="size-4" />,
  dashboards: <LayoutDashboard aria-hidden className="size-4" />,
  automations: <Workflow aria-hidden className="size-4" />,
  import: <Upload aria-hidden className="size-4" />,
  trash: <Trash2 aria-hidden className="size-4" />,
  admin: <ShieldCheck aria-hidden className="size-4" />,
  settings: <Settings aria-hidden className="size-4" />,
  workspace: <LayoutDashboard aria-hidden className="size-4" />,
};

function resultCount(data: PaletteSearchDto | undefined): number {
  if (!data) return 0;
  return data.items.length + data.boards.length + data.dashboards.length + data.people.length + data.workspaces.length;
}

export interface CommandPaletteProps {
  /** Extra record groups contributed by feature modules (search slot). */
  readonly extraGroups?: (query: string, close: () => void) => ReactNode;
}

export function CommandPalette({ extraGroups }: CommandPaletteProps) {
  const router = useRouter();
  const { org } = useOrg();
  const open = useShellStore((state) => state.panel === 'search');
  const openPanel = useShellStore((state) => state.openPanel);
  const closePanel = useShellStore((state) => state.closePanel);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const requestCreate = useShellStore((state) => state.requestCreate);
  const activeWorkspaceId = useShellStore((state) => state.activeWorkspaceByOrg[org.id] ?? null);
  const setActiveWorkspace = useShellStore((state) => state.setActiveWorkspace);
  const { resolved, setPreference } = useTheme();
  const canCreateBoard = useCan('board:create');
  const canInvite = useCan('member:invite');
  const canAdmin = useCan('org:update');
  const canReadWorkspaces = useCan('workspace:read');
  const crmBoards = useCrmBoards();
  const workspaceList = useWorkspaces(org.id);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  /** One group expanded to "See all" (null: every group, capped). */
  const [expanded, setExpanded] = useState<PaletteGroup | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Element focused before the palette opened, restored on close (WCAG 2.4.3). */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** Enter pressed while results were settling: open the top fresh match once it arrives. */
  const pendingEnterRef = useRef(false);

  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      returnFocusRef.current = document.activeElement;
    }
  }, [open]);

  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
  const searching = query.trim().length > 0;
  const search = usePaletteSearch(org.id, debounced, open && searching, {
    type: expanded ?? undefined,
    limit: expanded ? EXPANDED_LIMIT : GROUP_LIMIT,
  });
  const recents = useRecents(RECENT_LIMIT * 2);
  // Results belong to an older query while typing, or while placeholder data is shown: only
  // rows that still match the current text are listed, so Enter/click never opens a stale row.
  const stale = searching && (debounced !== query.trim() || search.isPlaceholderData);
  const results =
    searching && search.data ? (stale ? filterToQuery(query, search.data) : search.data) : undefined;
  const settling = searching && (stale || search.isFetching);
  const hasResults = resultCount(results) > 0;

  const close = useCallback(() => {
    closePanel();
    setQuery('');
    setSelected('');
    setExpanded(null);
  }, [closePanel]);

  const go = useCallback(
    (href: string) => {
      close();
      startRouteProgress();
      router.push(href);
    },
    [close, router],
  );

  // Buffer printable keys typed before the input is focused (e.g. right after ⌘K).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input || document.activeElement === input) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      event.preventDefault();
      setQuery((current) => current + event.key);
      input.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  const commands = useMemo(() => {
    const list = buildNavCommands({
      orgSlug: org.slug,
      crmBoards: crmBoards.data?.primary,
      workspaces: (canReadWorkspaces ? workspaceList.data : undefined)?.map((workspace) => ({ id: workspace.id, name: workspace.name, color: workspace.color })),
      canAdmin,
    }).map((command) => ({
      ...command,
      icon:
        command.icon === 'workspace' ? (
          <WorkspaceTile workspace={{ name: command.label, color: command.color ?? 'primary', icon: null }} size={20} />
        ) : (
          NAV_ICON[command.icon]
        ),
    }));
    const actions: { id: string; label: string; keywords: string; icon: ReactNode; hint?: string; href?: string; run?: () => void }[] = [];
    if (canCreateBoard && activeWorkspaceId) {
      actions.push({
        id: 'new-board',
        label: 'Create board',
        keywords: 'new board create add',
        icon: <Plus aria-hidden className="size-4" />,
        run: () => {
          close();
          requestCreate({ kind: 'board', workspaceId: activeWorkspaceId });
        },
      });
    }
    actions.push({ id: 'import', label: 'Import data', keywords: 'import csv excel upload', icon: <Upload aria-hidden className="size-4" />, href: routes.importData(org.slug) });
    if (canInvite) {
      actions.push({ id: 'invite', label: 'Invite members', keywords: 'invite teammates people add users', icon: <UserPlus aria-hidden className="size-4" />, run: () => openPanel('invite') });
    }
    actions.push(
      {
        id: 'theme',
        label: `Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`,
        keywords: 'theme dark light mode appearance',
        icon: resolved === 'dark' ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />,
        run: () => {
          setPreference(resolved === 'dark' ? 'light' : 'dark');
          close();
        },
      },
      { id: 'sidebar', label: 'Open the Workspaces menu', keywords: 'sidebar workspaces boards folders navigation', icon: <PanelLeft aria-hidden className="size-4" />, run: () => { toggleSidebar(); close(); } },
      { id: 'shortcuts', label: 'Keyboard shortcuts', keywords: 'keyboard shortcuts help hotkeys', icon: <Keyboard aria-hidden className="size-4" />, hint: '?', run: () => openPanel('shortcuts') },
    );
    return { nav: list, actions };
  }, [org.slug, crmBoards.data, workspaceList.data, canAdmin, canReadWorkspaces, canCreateBoard, canInvite, activeWorkspaceId, resolved, close, requestCreate, openPanel, setPreference, toggleSidebar]);

  const navMatches = searching
    ? commands.nav
        .filter((c) => matchesStrictly(query, `${c.label} ${c.keywords} ${c.meta ?? ''}`))
        .sort((a, b) => matchScore(query, b.label) - matchScore(query, a.label))
        .slice(0, 8)
    : commands.nav.filter((c) => DEFAULT_NAV_IDS.has(c.id));
  const actionMatches = searching
    ? commands.actions.filter((c) => matchesStrictly(query, `${c.label} ${c.keywords}`))
    : commands.actions;

  const recentList = useMemo(() => {
    const seen = new Set<string>();
    return (recents.data ?? [])
      .filter((visit) => {
        const key = `${visit.entityType}:${visit.entityId}`;
        if (seen.has(key) || !entityHref(org.slug, visit.entityType, visit.entityId)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, RECENT_LIMIT);
  }, [recents.data, org.slug]);

  // Registry of every rendered row, so Ctrl/⌘+Enter can open the selected target in a new tab.
  const entries = new Map<string, Entry>();
  const register = (entry: Entry) => {
    entries.set(entry.value, entry);
    return entry;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      const entry = entries.get(selected);
      if (entry?.href) {
        event.preventDefault();
        window.open(entry.href, '_blank', 'noopener');
      }
      return;
    }
    if (event.key === 'Enter' && settling) {
      // Never act on a row from an older query: wait for this query's results.
      event.preventDefault();
      pendingEnterRef.current = true;
      return;
    }
    if (event.key === 'Backspace' && expanded && query.length === 0) {
      event.preventDefault();
      setExpanded(null);
    }
  };

  /** "See all" row closing a capped group (or "Back to all results" while expanded). */
  const seeAll = (group: PaletteGroup) => {
    if (expanded === group) {
      const entry = register({ value: `back:${group}`, run: () => setExpanded(null) });
      return (
        <PaletteItem
          key={entry.value}
          value={entry.value}
          onSelect={entry.run}
          icon={<ArrowLeft aria-hidden className="size-4" />}
          testId="palette-back"
        >
          Back to all results
        </PaletteItem>
      );
    }
    if (expanded || stale || !results?.more?.[group]) return null;
    const entry = register({
      value: `more:${group}`,
      run: () => {
        setExpanded(group);
        setSelected('');
      },
    });
    return (
      <PaletteItem
        key={entry.value}
        value={entry.value}
        onSelect={entry.run}
        icon={<ChevronRight aria-hidden className="size-4" />}
        testId="palette-see-all"
        muted
      >
        See all {GROUP_LABEL[group]} matching “{query.trim()}”
      </PaletteItem>
    );
  };

  const rows: ReactNode[] = [];
  const recordGroups = new Map<PaletteGroup, ReactNode>();
  if (!searching) {
    if (recentList.length > 0) {
      rows.push(
        <Command.Group key="recent" heading="Recent" className={groupClass}>
          {recentList.map((visit) => {
            const href = entityHref(org.slug, visit.entityType, visit.entityId) ?? routes.home(org.slug);
            const entry = register({ value: `recent:${visit.entityType}:${visit.entityId}`, href, run: () => go(href) });
            return (
              <PaletteItem
                key={entry.value}
                value={entry.value}
                onSelect={entry.run}
                icon={
                  visit.entityType === 'workspace' ? (
                    <Clock aria-hidden className="size-4" />
                  ) : (
                    <EntityIcon
                      type={visit.entityType === 'dashboard' ? 'dashboard' : 'board'}
                      boardKind={visit.boardKind ?? undefined}
                    />
                  )
                }
                meta={visit.workspaceName ?? undefined}
                external
              >
                {visit.name}
              </PaletteItem>
            );
          })}
        </Command.Group>,
      );
    }
  } else if (results) {
    if (results.items.length > 0) {
      recordGroups.set(
        'items',
        <Command.Group key="items" heading="Items" className={groupClass}>
          {results.items.map((item) => {
            const href = routes.item(org.slug, item.boardId, item.id);
            const entry = register({ value: `item:${item.id}`, href, run: () => go(href) });
            return (
              <PaletteItem
                key={entry.value}
                value={entry.value}
                onSelect={entry.run}
                icon={<EntityIcon type="board" boardKind={item.boardKind} />}
                meta={
                  <>
                    <span className="truncate">{item.boardName}</span>
                    <span aria-hidden>›</span>
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: `var(--label-${toLabelColor(item.groupColor)})` }}
                    />
                    <span className="truncate">{item.groupTitle}</span>
                    {item.snippet ? (
                      <span className="truncate">
                        {' · '}
                        <HighlightText text={item.snippet} query={query} />
                      </span>
                    ) : null}
                  </>
                }
                hint={
                  item.status ? (
                    <StatusPill label={item.status.name} color={toLabelColor(item.status.color)} className="max-w-28" />
                  ) : null
                }
                external
              >
                <HighlightText text={item.name} query={query} />
              </PaletteItem>
            );
          })}
          {seeAll('items')}
        </Command.Group>,
      );
    }
    if (results.boards.length > 0) {
      recordGroups.set(
        'boards',
        <Command.Group key="boards" heading="Boards" className={groupClass}>
          {results.boards.map((board) => {
            const href = routes.board(org.slug, board.id);
            const entry = register({ value: `board:${board.id}`, href, run: () => go(href) });
            return (
              <PaletteItem
                key={entry.value}
                value={entry.value}
                onSelect={entry.run}
                icon={<EntityIcon type="board" boardKind={board.kind} />}
                meta={[board.workspaceName, board.folderName].filter(Boolean).join(' › ')}
                external
              >
                <HighlightText text={board.name} query={query} />
              </PaletteItem>
            );
          })}
          {seeAll('boards')}
        </Command.Group>,
      );
    }
    if (results.dashboards.length > 0) {
      recordGroups.set(
        'dashboards',
        <Command.Group key="dashboards" heading="Dashboards" className={groupClass}>
          {results.dashboards.map((dashboard) => {
            const href = routes.dashboard(org.slug, dashboard.id);
            const entry = register({ value: `dashboard:${dashboard.id}`, href, run: () => go(href) });
            return (
              <PaletteItem
                key={entry.value}
                value={entry.value}
                onSelect={entry.run}
                icon={<EntityIcon type="dashboard" />}
                meta={dashboard.workspaceName ?? 'Dashboard'}
                external
              >
                <HighlightText text={dashboard.name} query={query} />
              </PaletteItem>
            );
          })}
          {seeAll('dashboards')}
        </Command.Group>,
      );
    }
    if (results.people.length > 0) {
      recordGroups.set(
        'people',
        <Command.Group key="people" heading="People" className={groupClass}>
          {results.people.map((person) => {
            const href = routes.person(org.slug, person.id);
            const entry = register({ value: `person:${person.id}`, href, run: () => go(href) });
            return (
              <PaletteItem
                key={entry.value}
                value={entry.value}
                onSelect={entry.run}
                icon={<Avatar name={person.name} src={person.image} colorKey={person.id} size="sm" />}
                meta={<HighlightText text={person.title ? `${person.title} · ${person.email}` : person.email} query={query} />}
                external
              >
                <HighlightText text={person.name} query={query} />
              </PaletteItem>
            );
          })}
          {seeAll('people')}
        </Command.Group>,
      );
    }
    if (results.workspaces.length > 0) {
      recordGroups.set(
        'workspaces',
        <Command.Group key="workspaces" heading="Workspaces" className={groupClass}>
          {results.workspaces.map((workspace) => {
            const href = routes.workspace(org.slug, workspace.id);
            const entry = register({
              value: `workspace:${workspace.id}`,
              href,
              run: () => {
                setActiveWorkspace(org.id, workspace.id);
                go(href);
              },
            });
            return (
              <PaletteItem
                key={entry.value}
                value={entry.value}
                onSelect={entry.run}
                icon={<WorkspaceTile workspace={{ name: workspace.name, color: workspace.color, icon: null }} size={22} />}
                meta={workspace.kind === 'closed' ? 'Closed workspace' : 'Workspace'}
                external
              >
                <HighlightText text={workspace.name} query={query} />
              </PaletteItem>
            );
          })}
          {seeAll('workspaces')}
        </Command.Group>,
      );
    }
  }

  const navGroup =
    navMatches.length > 0 && !expanded ? (
      <Command.Group key="nav" heading="Go to" className={groupClass}>
        {navMatches.map((command) => {
          const href = command.href;
          const entry = register({ value: `nav:${command.id}`, href, run: () => go(href) });
          return (
            <PaletteItem
              key={entry.value}
              value={entry.value}
              onSelect={entry.run}
              icon={command.icon}
              meta={searching ? command.meta : undefined}
              hint={command.hint ? <Kbd>{command.hint}</Kbd> : null}
              testId="palette-nav"
            >
              <HighlightText text={command.label} query={query} />
            </PaletteItem>
          );
        })}
      </Command.Group>
    ) : null;
  // Record groups ordered by best match; "Go to" leads when a page name matches at least as
  // well as any record (e.g. "pipel" → Pipeline), otherwise it follows the records.
  const orderedGroups = results ? orderPaletteGroups(query, results) : [];
  const recordNodes = orderedGroups.map((group) => recordGroups.get(group)).filter(Boolean);
  const bestRecord = results
    ? Math.max(
        -1,
        ...results.items.map((r) => matchScore(query, r.name)),
        ...results.boards.map((r) => matchScore(query, r.name)),
        ...results.dashboards.map((r) => matchScore(query, r.name)),
        ...results.people.map((r) => matchScore(query, r.name)),
        ...results.workspaces.map((r) => matchScore(query, r.name)),
      )
    : -1;
  const bestNav = navMatches.reduce((best, c) => Math.max(best, matchScore(query, c.label)), -1);
  if (navGroup && (!searching || bestNav >= bestRecord)) rows.push(navGroup, ...recordNodes);
  else rows.push(...recordNodes, ...(navGroup ? [navGroup] : []));
  if (actionMatches.length > 0 && !expanded) {
    rows.push(
      <Command.Group key="actions" heading="Actions" className={groupClass}>
        {actionMatches.map((command) => {
          const entry = register({
            value: `action:${command.id}`,
            href: command.href,
            run: command.run ?? (() => command.href && go(command.href)),
          });
          return (
            <PaletteItem key={entry.value} value={entry.value} onSelect={entry.run} icon={command.icon} hint={command.hint ? <Kbd>{command.hint}</Kbd> : null}>
              <HighlightText text={command.label} query={query} />
            </PaletteItem>
          );
        })}
      </Command.Group>,
    );
  }


  const showError = searching && search.isError && !results;
  // Loading whenever nothing is visible yet, even if an older query had returned results.
  const showSkeleton = searching && settling && rows.length === 0 && !showError;
  const showEmpty =
    searching && !settling && !showError && !hasResults && navMatches.length === 0 && actionMatches.length === 0;
  if (showEmpty && !expanded) {
    const term = query.trim();
    const fallbacks: ReactNode[] = [];
    if (canCreateBoard && activeWorkspaceId) {
      const entry = register({
        value: 'fallback:create-board',
        run: () => {
          close();
          requestCreate({ kind: 'board', workspaceId: activeWorkspaceId, name: term.slice(0, 80) });
        },
      });
      fallbacks.push(
        <PaletteItem key={entry.value} value={entry.value} onSelect={entry.run} icon={<Plus aria-hidden className="size-4" />} testId="palette-fallback">
          Create board “{term}”
        </PaletteItem>,
      );
    }
    const myWork = routes.myWork(org.slug);
    const workEntry = register({ value: 'fallback:my-work', href: myWork, run: () => go(myWork) });
    fallbacks.push(
      <PaletteItem key={workEntry.value} value={workEntry.value} onSelect={workEntry.run} icon={<CalendarCheck2 aria-hidden className="size-4" />} testId="palette-fallback">
        Look in My work
      </PaletteItem>,
    );
    const inbox = routes.inbox(org.slug);
    const inboxEntry = register({ value: 'fallback:inbox', href: inbox, run: () => go(inbox) });
    fallbacks.push(
      <PaletteItem key={inboxEntry.value} value={inboxEntry.value} onSelect={inboxEntry.run} icon={<Inbox aria-hidden className="size-4" />} testId="palette-fallback">
        Look in Inbox updates
      </PaletteItem>,
    );
    rows.push(
      <Command.Group key="fallback" heading="Try instead" className={groupClass}>
        {fallbacks}
      </Command.Group>,
    );
  }
  const listEmpty = rows.length === 0 && !extraGroups;

  // Enter pressed while settling: once this query's rows are in, open the selection (if it is
  // still listed) or the top match. Runs after every render; cheap when nothing is pending.
  useEffect(() => {
    if (!pendingEnterRef.current) return;
    if (!open) {
      pendingEnterRef.current = false;
      return;
    }
    if (settling) return;
    pendingEnterRef.current = false;
    const target = pickEnterTarget(selected, [...entries.keys()].filter((key) => !key.startsWith('fallback:')));
    if (target) entries.get(target)?.run();
  });

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(value) => (value ? openPanel('search') : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay/60 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          aria-label="Search and commands"
          data-testid="command-palette"
          data-settling={settling || undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef.current;
            returnFocusRef.current = null;
            const fallback = [...document.querySelectorAll<HTMLElement>('[data-search-trigger]')].find(
              (element) => element.offsetParent !== null,
            );
            (target && target.isConnected ? target : fallback)?.focus();
          }}
          className="fixed top-[10vh] left-1/2 z-[var(--z-modal)] w-[min(720px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-xl border border-border-subtle bg-raised shadow-modal outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in"
        >
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Find items, boards, dashboards, people and workspaces, or run a command.
          </DialogPrimitive.Description>
          <Command
            loop
            shouldFilter={false}
            value={selected}
            onValueChange={setSelected}
            onKeyDown={onKeyDown}
            label="Search and commands"
            className="flex max-h-[min(600px,76vh)] flex-col"
          >
            <div className="flex items-center gap-3 border-b border-border-subtle px-4">
              <Search aria-hidden className="size-5 shrink-0 text-icon" />
              <Command.Input
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                placeholder="Search items, boards, people… or type a command"
                aria-busy={settling || undefined}
                className="h-14 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-placeholder"
              />
              {settling && results ? (
                <span className="h-0.5 w-10 overflow-hidden rounded-full bg-border-subtle" aria-hidden>
                  <span className="block h-full w-1/2 animate-[ks-indeterminate_0.9s_linear_infinite] rounded-full bg-primary [position:relative]" />
                </span>
              ) : null}
              <Kbd>Esc</Kbd>
            </div>
            {showSkeleton ? <ResultSkeleton /> : null}
            {showError ? (
              <div role="alert" className="flex flex-col items-center gap-2 px-6 py-8 text-center" data-testid="palette-error">
                <Illustration name="error" size={88} />
                <span className="font-semibold text-fg">Search is unavailable right now</span>
                <button
                  type="button"
                  onClick={() => void search.refetch()}
                  className="rounded-sm px-2 py-1 text-sm font-semibold text-primary-text transition-colors duration-[var(--duration-fast)] hover:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-focus active:bg-primary-selected"
                >
                  Try again
                </button>
              </div>
            ) : showEmpty ? (
              <div className="flex items-center gap-4 px-6 pt-5 pb-2" data-testid="palette-empty">
                <Illustration name="search" size={72} className="shrink-0" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-semibold text-fg" title={query.trim()}>
                    No results for “{query.trim()}”
                  </span>
                  <span className="text-sm text-fg-muted">
                    Check the spelling, or search by a board, person, or company name.
                  </span>
                </div>
              </div>
            ) : null}
            {/* Hidden (not unmounted) while it has no options: the input's aria-controls keeps a
                valid target and an empty listbox is never exposed (ARIA required-children). */}
            <Command.List hidden={listEmpty} className="min-h-0 flex-1 overflow-y-auto pb-2">
              {extraGroups ? extraGroups(query, close) : null}
              {rows}
            </Command.List>
            <div className="hidden items-center gap-4 border-t border-border-subtle bg-sunken px-4 py-2 text-xs text-fg-muted sm:flex">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> open
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Ctrl</Kbd>
                <Kbd>↵</Kbd> new tab
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Kbd>Esc</Kbd> close
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
