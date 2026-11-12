'use client';
/**
 * Primary navigation in the top bar (md and up), matching the KitStak WMS shell:
 *   Home · My work · Inbox · CRM ▾ · Workspaces ▾ · ★ Favorites
 * CRM lists the pipeline and CRM object boards; Workspaces holds the workspace switcher and the
 * folder / board tree; Favorites lists starred boards, dashboards and folders. Below md the same
 * destinations live in the off-canvas drawer (mobile-nav.tsx).
 */
import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Star } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tooltip,
  cn,
} from '@/components/ui';
import { useCrmNavItems } from '@/features/crm/nav/crm-sidebar-section';
import { useOrg } from '../org-context';
import { routes } from '../routes';
import { FavoritesSection } from '../sidebar/favorites-section';
import { WorkspacesSection } from '../sidebar/sidebar';
import { useShellStore, type NavMenuKey } from '../store';

/** Same trigger recipe as the WMS top bar: 56px tall, 13px medium, crimson underline when active. */
const triggerClass = [
  'group relative flex h-14 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium whitespace-nowrap outline-none',
  'transition-colors duration-[var(--duration-fast)]',
  'focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
  'data-[state=open]:text-fg',
].join(' ');

const toneClass = (active: boolean) => (active ? 'text-fg' : 'text-fg-secondary hover:text-fg');

/** Route-active underline; an open trigger shows it too. */
function ActiveUnderline({ show }: { readonly show: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-x-2 bottom-2 h-0.5 rounded-full bg-primary transition-opacity',
        show ? 'opacity-100' : 'opacity-0 group-data-[state=open]:opacity-100',
      )}
    />
  );
}

function NavLink({ href, active, children }: { readonly href: string; readonly active: boolean; readonly children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={cn(triggerClass, toneClass(active))}>
      {children}
      <ActiveUnderline show={active} />
    </Link>
  );
}

/** A portaled menu, dialog or popover opened from inside a nav panel must not close the panel. */
function nestedOverlayOpen(): boolean {
  return Boolean(document.querySelector('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]'));
}

function useNavMenu(key: NavMenuKey): { readonly open: boolean; readonly onOpenChange: (open: boolean) => void } {
  const open = useShellStore((state) => state.navMenu === key);
  const setNavMenu = useShellStore((state) => state.setNavMenu);
  return { open, onOpenChange: (next) => setNavMenu(next ? key : null) };
}

function CrmMenu() {
  const items = useCrmNavItems();
  const menu = useNavMenu('crm');
  if (items !== null && items.length === 0) return null;
  const active = Boolean(items?.some((item) => item.active));
  return (
    <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="topnav-crm"
          aria-current={active ? 'page' : undefined}
          className={cn(triggerClass, toneClass(active))}
        >
          CRM
          <ChevronDown aria-hidden className="size-3.5 opacity-70 transition-transform group-data-[state=open]:rotate-180" />
          <ActiveUnderline show={active} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0} className="w-56" data-testid="crm-nav-menu">
        {items === null ? (
          <div className="flex flex-col gap-2 p-2" aria-busy="true" data-testid="crm-nav-skeleton">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} width={`${56 + ((index * 17) % 30)}%`} height={12} rounded="sm" />
            ))}
          </div>
        ) : (
          items.map((item) => (
            // A real link inside the menu item, so Cmd/Ctrl-click opens a new tab.
            <MenuPrimitive.Item key={item.key} asChild>
              <Link
                href={item.href}
                data-testid={`crm-nav-${item.key}`}
                aria-current={item.active ? 'page' : undefined}
                className="ks-menu-item gap-2 aria-[current=page]:bg-selected aria-[current=page]:font-medium [&_svg]:!size-4 [&_svg]:text-icon"
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </Link>
            </MenuPrimitive.Item>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspacesMenu({ active }: { readonly active: boolean }) {
  const menu = useNavMenu('workspaces');
  return (
    <Popover open={menu.open} onOpenChange={menu.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="topnav-workspaces"
          aria-current={active ? 'page' : undefined}
          aria-keyshortcuts="Control+\\ Meta+\\"
          className={cn(triggerClass, toneClass(active))}
        >
          Workspaces
          <ChevronDown aria-hidden className="size-3.5 opacity-70 transition-transform group-data-[state=open]:rotate-180" />
          <ActiveUnderline show={active} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        flush
        align="start"
        sideOffset={0}
        aria-label="Workspaces"
        data-testid="workspaces-menu"
        tabIndex={-1}
        // Focus the panel itself (not its first button) so no tooltip pops on open.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        // Row menus, pickers and dialogs opened from the tree are portaled outside this panel.
        onInteractOutside={(event) => {
          if (nestedOverlayOpen()) event.preventDefault();
        }}
        className="z-[calc(var(--z-dropdown)-1)] flex h-[min(72vh,600px)] w-[340px] max-w-[calc(100vw-24px)] flex-col overflow-hidden px-2 pt-3"
      >
        <WorkspacesSection />
      </PopoverContent>
    </Popover>
  );
}

function FavoritesMenu() {
  const menu = useNavMenu('favorites');
  return (
    <Popover open={menu.open} onOpenChange={menu.onOpenChange}>
      <Tooltip content="Favorites" disabled={menu.open}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Favorites"
            data-testid="topnav-favorites"
            className={cn(triggerClass, 'px-2', toneClass(false))}
          >
            <Star aria-hidden className="size-4" />
            <ChevronDown aria-hidden className="size-3.5 opacity-70 transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        flush
        align="start"
        sideOffset={0}
        aria-label="Favorites"
        data-testid="favorites-menu"
        onInteractOutside={(event) => {
          if (nestedOverlayOpen()) event.preventDefault();
        }}
        className="z-[calc(var(--z-dropdown)-1)] max-h-[min(72vh,480px)] w-72 max-w-[calc(100vw-24px)] p-2"
      >
        <FavoritesSection collapsible={false} />
      </PopoverContent>
    </Popover>
  );
}

export function TopNav() {
  const { org } = useOrg();
  const pathname = usePathname() ?? '';
  const setNavMenu = useShellStore((state) => state.setNavMenu);
  const crmItems = useCrmNavItems();
  const crmActive = Boolean(crmItems?.some((item) => item.active));

  // Navigating closes whichever menu was open.
  useEffect(() => {
    setNavMenu(null);
  }, [pathname, setNavMenu]);

  const home = routes.home(org.slug);
  const myWork = routes.myWork(org.slug);
  const inbox = routes.inbox(org.slug);
  const inWorkspaces =
    !crmActive && /\/(workspaces|boards|dashboards)(\/|$)/.test(pathname.slice(`/${org.slug}`.length));

  return (
    <nav aria-label="Main navigation" data-testid="top-nav" className="hidden min-w-0 items-center md:flex">
      <NavLink href={home} active={pathname === home}>
        Home
      </NavLink>
      <NavLink href={myWork} active={pathname.startsWith(myWork)}>
        My work
      </NavLink>
      <NavLink href={inbox} active={pathname.startsWith(inbox)}>
        Inbox
      </NavLink>
      <CrmMenu />
      <WorkspacesMenu active={inWorkspaces} />
      <FavoritesMenu />
    </nav>
  );
}
