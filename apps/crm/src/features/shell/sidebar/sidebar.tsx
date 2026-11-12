'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarCheck2, ChevronsLeft, ChevronsRight, House, Inbox, LayoutGrid, Search, Star, X } from 'lucide-react';
import { IconButton, Input, Tooltip, cn, useModKey } from '@/components/ui';
import { useWorkspaces } from '../api';
import { useCan, useOrg } from '../org-context';
import { routes } from '../routes';
import { useShellStore } from '../store';
import { AddMenu } from './add-menu';
import { FavoritesSection } from './favorites-section';
import { NavRow } from './nav-row';
import { ResizeHandle } from './resize-handle';
import { WorkspaceSwitcher, WorkspaceTile } from './workspace-switcher';
import { WorkspaceMenu } from './workspace-menu';
import { WorkspaceTree } from './workspace-tree';
import { CrmSidebarSection } from '@/features/crm/nav/crm-sidebar-section';

const RAIL_WIDTH = 56;

export function useActiveWorkspaceId(): { readonly id: string | null; readonly select: (id: string) => void } {
  const { org } = useOrg();
  const workspaces = useWorkspaces(org.id);
  const stored = useShellStore((state) => state.activeWorkspaceByOrg[org.id]);
  const setActive = useShellStore((state) => state.setActiveWorkspace);
  const pathname = usePathname() ?? '';
  const routeWorkspace = /\/workspaces\/([0-9a-f-]{36})/i.exec(pathname)?.[1] ?? null;

  const list = workspaces.data ?? [];
  const candidate = routeWorkspace ?? stored ?? null;
  const id = list.find((workspace) => workspace.id === candidate)?.id ?? list[0]?.id ?? null;

  useEffect(() => {
    if (routeWorkspace && routeWorkspace !== stored) setActive(org.id, routeWorkspace);
  }, [routeWorkspace, stored, setActive, org.id]);

  return { id, select: (next) => setActive(org.id, next) };
}

function PrimaryNav({ collapsed }: { readonly collapsed: boolean }) {
  const { org } = useOrg();
  const pathname = usePathname() ?? '';
  const openPanel = useShellStore((state) => state.openPanel);
  const mod = useModKey();
  const items = [
    {
      href: routes.home(org.slug),
      label: 'Home',
      icon: <House aria-hidden className="size-[18px]" />,
      exact: true,
    },
    {
      href: routes.myWork(org.slug),
      label: 'My work',
      icon: <CalendarCheck2 aria-hidden className="size-[18px]" />,
      exact: false,
    },
    {
      href: routes.inbox(org.slug),
      label: 'Inbox',
      icon: <Inbox aria-hidden className="size-[18px]" />,
      exact: false,
    },
  ];
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Tooltip key={item.href} content={item.label} side="right">
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className="inline-flex size-9 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:bg-selected aria-[current=page]:text-primary-text"
              >
                {item.icon}
              </Link>
            </Tooltip>
          );
        })}
        <IconButton
          label="Search"
          shortcut={[mod, 'K']}
          tooltipSide="right"
          icon={<Search aria-hidden />}
          className="size-9 rounded-md"
          onClick={() => openPanel('search')}
        />
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-px">
      {items.map((item) => (
        <li key={item.href}>
          <NavRow
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Workspace switcher, add / manage menus, filter and the folder + board tree. */
export function WorkspacesSection() {
  const { org } = useOrg();
  const pathname = usePathname() ?? '';
  const workspaces = useWorkspaces(org.id);
  const { id: activeId, select } = useActiveWorkspaceId();
  const activeWorkspace = workspaces.data?.find((workspace) => workspace.id === activeId) ?? null;
  const requestCreate = useShellStore((state) => state.requestCreate);
  const canCreateWorkspace = useCan('workspace:write');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  const closeSearch = () => {
    setQuery('');
    setSearching(false);
  };

  return (
    <section aria-labelledby="sidebar-workspaces" className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex h-7 items-center justify-between pr-1 pl-2">
        <h2
          id="sidebar-workspaces"
          className="font-sans text-sm font-medium tracking-normal text-fg-secondary"
        >
          Workspaces
        </h2>
        <IconButton
          label={searching ? 'Close search' : 'Search in workspace'}
          icon={searching ? <X aria-hidden /> : <Search aria-hidden />}
          size="xs"
          onClick={() => (searching ? closeSearch() : setSearching(true))}
          active={searching}
        />
      </div>
      <div className="flex items-center gap-1 px-1">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher
            workspaces={workspaces.data}
            loading={workspaces.isPending}
            activeId={activeId}
            onSelect={select}
            onCreate={canCreateWorkspace ? () => requestCreate({ kind: 'workspace' }) : undefined}
            selected={Boolean(activeId) && pathname.startsWith(routes.workspace(org.slug, activeId ?? ''))}
          />
        </div>
        {activeWorkspace ? <WorkspaceMenu workspace={activeWorkspace} /> : null}
        <AddMenu workspaceId={activeId} />
      </div>
      {workspaces.isError ? (
        <div role="alert" className="mx-1 rounded-md bg-danger-subtle p-3 text-sm text-danger-text">
          Couldn&apos;t load workspaces.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void workspaces.refetch()}>
            Retry
          </button>
        </div>
      ) : null}
      {searching ? (
        <div className="px-1 animate-fade-in">
          <Input
            ref={searchRef}
            size="sm"
            value={query}
            placeholder="Filter boards and folders"
            aria-label="Filter boards and folders"
            leadingIcon={<Search aria-hidden />}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeSearch();
              }
            }}
          />
        </div>
      ) : null}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <WorkspaceTree workspaceId={activeId} query={query} />
      </div>
    </section>
  );
}

const PEEK_OPEN_MS = 300;
const PEEK_CLOSE_MS = 300;

/** Is a menu / popover / dialog (portaled) open? Then the peek must not close under it. */
function overlayOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]',
    ),
  );
}

/** Expanded sidebar body: nav, favorites, workspace switcher + tree. */
function SidebarBody() {
  return (
    <>
      <PrimaryNav collapsed={false} />
      <CrmSidebarSection />
      <div className="h-px shrink-0 bg-border-subtle" />
      <FavoritesSection />
      <div className="h-px shrink-0 bg-border-subtle" />
      <WorkspacesSection />
    </>
  );
}

/** Collapsed rail shortcuts that reveal the full sidebar (click / keyboard; hover also peeks). */
function RailShortcuts({ onPeek, peeking }: { readonly onPeek: () => void; readonly peeking: boolean }) {
  const { org } = useOrg();
  const workspaces = useWorkspaces(org.id);
  const { id } = useActiveWorkspaceId();
  const active = workspaces.data?.find((workspace) => workspace.id === id);
  return (
    <div className="flex flex-col items-center gap-1 border-t border-border-subtle pt-3">
      <IconButton
        label="Favorites"
        tooltipSide="right"
        hideTooltip={peeking}
        icon={<Star aria-hidden />}
        className="size-9 rounded-md"
        onClick={onPeek}
      />
      <Tooltip content={active ? `Workspace: ${active.name}` : 'Workspaces'} side="right" disabled={peeking}>
        <button
          type="button"
          aria-label={active ? `Show workspace ${active.name}` : 'Show workspaces'}
          data-testid="rail-workspaces"
          onClick={onPeek}
          className="inline-flex size-9 items-center justify-center rounded-md transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
        >
          {active ? (
            <WorkspaceTile workspace={active} size={24} />
          ) : (
            <LayoutGrid aria-hidden className="size-[18px] text-icon" />
          )}
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Navigation body. On desktop the app uses the top bar (see top-nav/top-nav.tsx); this
 * component now renders inside the off-canvas drawer below the md breakpoint (variant="drawer").
 * The docked and rail variants are kept so nothing that imports them breaks.
 *
 * Left sidebar. Expanded: primary nav, favorites and the workspace tree; resizable and persisted.
 * Collapsed: a 56px icon rail; hovering it (300ms) or clicking a rail shortcut peeks the full
 * sidebar as an overlay without reflowing content. Toggle with the edge button or Ctrl/⌘ + \.
 */
export interface SidebarProps {
  /**
   * docked: user-controlled width/collapse (desktop). rail: forced icon rail (tablet widths).
   * drawer: full-width expanded content inside the off-canvas navigation drawer (phones).
   */
  readonly variant?: 'docked' | 'rail' | 'drawer';
}

export function Sidebar({ variant = 'docked' }: SidebarProps) {
  const storedCollapsed = useShellStore((state) => state.sidebarCollapsed);
  const storedWidth = useShellStore((state) => state.sidebarWidth);
  const setWidth = useShellStore((state) => state.setSidebarWidth);
  const toggle = useShellStore((state) => state.toggleSidebar);
  const [preview, setPreview] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const collapsed = variant === 'rail' ? true : variant === 'drawer' ? false : storedCollapsed;
  // The peek is tied to the route + layout it was opened on: navigating or expanding closes it.
  const peekScope = `${pathname}|${collapsed}`;
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const peek = peekKey === peekScope;
  const setPeek = (open: boolean) => setPeekKey(open ? peekScope : null);
  const width = variant === 'drawer' ? '100%' : collapsed ? RAIL_WIDTH : (preview ?? storedWidth);
  const mod = useModKey();
  const shortcut = useMemo(() => [mod, '\\'], [mod]);
  const userControlled = variant === 'docked';

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const schedule = (open: boolean) => {
    clearTimer();
    timer.current = window.setTimeout(
      () => {
        if (!open && overlayOpen()) {
          schedule(false);
          return;
        }
        setPeek(open);
      },
      open ? PEEK_OPEN_MS : PEEK_CLOSE_MS,
    );
  };
  const openPeekNow = () => {
    clearTimer();
    setPeek(true);
    window.requestAnimationFrame(() => peekRef.current?.querySelector<HTMLElement>('a, button')?.focus());
  };

  useEffect(() => clearTimer, []);

  return (
    <aside
      aria-label="Sidebar"
      data-testid="app-sidebar"
      data-collapsed={collapsed || undefined}
      data-variant={variant}
      className={cn(
        'group/sidebar relative flex h-full shrink-0 flex-col',
        preview === null && 'transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-standard)]',
      )}
      style={{ width }}
      onMouseEnter={collapsed ? () => schedule(true) : undefined}
      onMouseLeave={collapsed ? () => schedule(false) : undefined}
    >
      <nav
        aria-label="Workspace sidebar"
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-2',
          collapsed ? 'items-center px-2' : 'pr-2 pl-3',
        )}
      >
        {collapsed ? (
          <>
            <PrimaryNav collapsed />
            <CrmSidebarSection collapsed />
            <RailShortcuts onPeek={openPeekNow} peeking={peek} />
          </>
        ) : (
          <SidebarBody />
        )}
      </nav>
      {collapsed && peek ? (
        <div
          aria-hidden
          data-testid="sidebar-peek-scrim"
          className="pointer-events-none fixed inset-x-0 top-[var(--topbar-height)] bottom-0 z-[calc(var(--z-sidebar-peek)-1)] animate-fade-in bg-[var(--surface-overlay)] opacity-30"
        />
      ) : null}
      {collapsed && peek ? (
        <div
          ref={peekRef}
          data-testid="sidebar-peek"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !overlayOpen()) setPeek(false);
          }}
          className="absolute top-0 left-0 z-[var(--z-sidebar-peek)] flex h-[calc(100%-8px)] animate-[ks-peek-in_160ms_var(--ease-out)] flex-col gap-3 overflow-hidden rounded-r-xl border border-l-0 border-border-default bg-panel pt-2 pr-2 pl-3 shadow-[var(--elevation-popover)]"
          style={{ width: storedWidth }}
        >
          <SidebarBody />
        </div>
      ) : null}
      {userControlled ? (
        <IconButton
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          shortcut={shortcut}
          tooltipSide="right"
          icon={collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
          size="xs"
          round
          variant="outline"
          onClick={toggle}
          data-testid="sidebar-toggle"
          className={cn(
            'absolute top-3 -right-3 z-[var(--z-sidebar)] shadow-sm transition-opacity duration-[var(--duration-fast)] group-hover/sidebar:opacity-100 focus-visible:opacity-100',
            collapsed ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
      {userControlled && !collapsed ? (
        <ResizeHandle
          width={typeof width === 'number' ? width : storedWidth}
          onPreview={setPreview}
          onCommit={(next) => {
            setPreview(null);
            setWidth(next);
          }}
        />
      ) : null}
    </aside>
  );
}
