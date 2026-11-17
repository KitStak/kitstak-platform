'use client';
/**
 * Left navigation: Home, Jobs, Log work, Profit, Labor, Alerts, Reports and the More group
 * (Target pace, Calculator, Goals, Import and export, Settings). The list comes from
 * src/lib/nav.ts and is filtered by the person's Pulse role. Collapses to a 56px icon rail
 * (persisted); below md it renders inside the mobile drawer (variant="drawer").
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { CountBadge, IconButton, Tooltip, cn } from '@/components/ui';
import { navFor, navMatches, type NavEntry } from '@/lib/nav';
import { NAV_ICONS } from './nav-icons';
import { useShell, type ShellBadges } from './shell-context';
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

const BADGE_WORDS: Readonly<Record<NonNullable<NavEntry['badge']>, (count: number) => string>> = {
  jobsAtRisk: (count) => (count === 1 ? '1 job needs you' : `${count} jobs need you`),
  openAlerts: (count) => (count === 1 ? '1 open alert' : `${count} open alerts`),
};

function badgeFor(entry: NavEntry, badges: ShellBadges | undefined): number {
  return entry.badge ? (badges?.[entry.badge] ?? 0) : 0;
}

function NavLink({ entry, collapsed, badge }: { readonly entry: NavEntry; readonly collapsed: boolean; readonly badge: number }) {
  const pathname = usePathname() ?? '/';
  const active = navMatches(entry, pathname);
  const Icon = NAV_ICONS[entry.id];
  const badgeWords = badge > 0 && entry.badge ? BADGE_WORDS[entry.badge](badge) : null;
  const label = badgeWords ? `${entry.label}, ${badgeWords}` : entry.label;
  if (collapsed) {
    return (
      <Tooltip content={badgeWords ? `${entry.label} (${badgeWords})` : entry.label} side="right">
        <Link
          href={entry.href}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          data-testid={`nav-${entry.id}`}
          className="relative inline-flex size-9 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:bg-selected aria-[current=page]:text-primary-text"
        >
          <Icon aria-hidden className="size-[18px]" />
          {badge > 0 ? (
            <span className="absolute -top-0.5 -right-0.5">
              <CountBadge count={badge} ringClassName="ring-[var(--surface-app)]" />
            </span>
          ) : null}
        </Link>
      </Tooltip>
    );
  }
  return (
    <Link href={entry.href} aria-label={badgeWords ? label : undefined} aria-current={active ? 'page' : undefined} data-testid={`nav-${entry.id}`} className={rowClass}>
      <span data-row-icon className="flex size-5 shrink-0 items-center justify-center text-icon">
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {badge > 0 ? <CountBadge count={badge} tone="danger" /> : null}
    </Link>
  );
}

function SectionHeading({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-7 items-center pr-1 pl-2">
      <span className="text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{children}</span>
    </div>
  );
}

export interface SidebarProps {
  readonly variant?: 'docked' | 'drawer';
}

export function Sidebar({ variant = 'docked' }: SidebarProps) {
  const { pulseRole, badges } = useShell();
  const storeCollapsed = useShellStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const collapsed = variant === 'docked' && storeCollapsed;
  const entries = navFor(pulseRole);
  const main = entries.filter((entry) => entry.group === 'main');
  const more = entries.filter((entry) => entry.group === 'more');

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
            {main.map((entry) => (
              <NavLink key={entry.id} entry={entry} collapsed badge={badgeFor(entry, badges)} />
            ))}
            {more.length > 0 ? <span aria-hidden className="my-1 h-px w-6 bg-border-subtle" /> : null}
            {more.map((entry) => (
              <NavLink key={entry.id} entry={entry} collapsed badge={badgeFor(entry, badges)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-px">
              {main.map((entry) => (
                <li key={entry.id}>
                  <NavLink entry={entry} collapsed={false} badge={badgeFor(entry, badges)} />
                </li>
              ))}
            </ul>
            {more.length > 0 ? (
              <div data-testid="sidebar-more">
                <SectionHeading>More</SectionHeading>
                <ul className="flex flex-col gap-px">
                  {more.map((entry) => (
                    <li key={entry.id}>
                      <NavLink entry={entry} collapsed={false} badge={badgeFor(entry, badges)} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {variant === 'docked' ? (
        <div className={cn('flex shrink-0 items-center border-t border-border-subtle py-2', collapsed ? 'justify-center px-2' : 'justify-end px-2.5')}>
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            tooltipSide="right"
            icon={collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
            onClick={toggleSidebar}
            data-testid="sidebar-toggle"
          />
        </div>
      ) : null}
    </nav>
  );
}
