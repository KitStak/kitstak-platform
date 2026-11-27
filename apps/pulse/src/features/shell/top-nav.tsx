'use client';
/**
 * Primary navigation in the top bar (lg and up): Home, Jobs, Programs (where the program tracker
 * is on), Log work, Profit, Labor, Alerts and
 * Reports as links, then a More menu with Target pace, Calculator, Goals, Import and export and
 * Settings. The list comes from src/lib/nav.ts, filtered by the person's Pulse role.
 *
 * When the bar is too narrow for every link, the ones at the end move into More, so nothing is
 * ever clipped. Below lg the whole list lives in the menu sheet (mobile-nav.tsx).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { CountBadge, DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger, MenuItemBody, cn } from '@/components/ui';
import { navMatches, type NavEntry } from '@/lib/nav';
import { NAV_ICONS } from './nav-icons';
import { badgeFor, badgeLabel, useNavGroups } from './nav-model';

// Never below 13px: people read these all day. Room is made with tighter padding, not smaller type.
const triggerClass = [
  'group relative flex h-[var(--topbar-height)] shrink-0 items-center gap-1 px-2 text-[13px] leading-none font-semibold whitespace-nowrap text-fg-secondary outline-none xl:px-2.5 xl:text-sm',
  'transition-colors duration-[var(--duration-instant)] ease-out hover:text-fg',
  'focus-visible:outline-2 focus-visible:-outline-offset-[6px] focus-visible:outline-focus',
  'aria-[current=page]:text-fg data-[active=true]:text-fg data-[state=open]:text-fg',
].join(' ');

/** The bar under the current page's link. An open More menu shows it too. */
function ActiveUnderline({ show }: { readonly show: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-x-2 bottom-2 h-0.5 rounded-full bg-primary transition-opacity duration-[var(--duration-instant)] xl:inset-x-2.5',
        show ? 'opacity-100' : 'opacity-0 group-data-[state=open]:opacity-100',
      )}
    />
  );
}

function BarLink({ entry, badge, active, parked }: { readonly entry: NavEntry; readonly badge: number; readonly active: boolean; readonly parked: boolean }) {
  return (
    <Link
      href={entry.href}
      aria-label={badgeLabel(entry, badge)}
      aria-current={active ? 'page' : undefined}
      // A parked link (moved into More) stays in the layout only so its width can be measured.
      tabIndex={parked ? -1 : undefined}
      data-testid={parked ? undefined : `nav-${entry.id}`}
      className={triggerClass}
    >
      {entry.label}
      {badge > 0 ? <CountBadge count={badge} /> : null}
      <ActiveUnderline show={active} />
    </Link>
  );
}

function MenuLink({ entry, badge, active }: { readonly entry: NavEntry; readonly badge: number; readonly active: boolean }) {
  const Icon = NAV_ICONS[entry.id];
  return (
    <Menu.Item asChild>
      <Link
        href={entry.href}
        aria-label={badgeLabel(entry, badge)}
        aria-current={active ? 'page' : undefined}
        data-testid={`nav-${entry.id}`}
        className="ks-menu-item aria-[current=page]:bg-selected aria-[current=page]:font-medium aria-[current=page]:text-primary-text [&[aria-current=page]>svg]:text-primary-text"
      >
        <MenuItemBody icon={<Icon aria-hidden />}>{entry.label}</MenuItemBody>
        {badge > 0 ? <CountBadge count={badge} /> : null}
      </Link>
    </Menu.Item>
  );
}

/** How many links fit in `available` px, keeping room for the More button whenever it is needed. */
export function fitCount(widths: readonly number[], available: number, moreWidth: number, alwaysMore: boolean): number {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total + (alwaysMore ? moreWidth : 0) <= available) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of widths) {
    if (used + width > available) break;
    used += width;
    count += 1;
  }
  return count;
}

export function TopNav() {
  const { main, more, badges } = useNavGroups();
  const pathname = usePathname() ?? '/';
  const navRef = useRef<HTMLElement>(null);
  const [fits, setFits] = useState(main.length);
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    // Close the menu after going somewhere (state adjusted during render, no effect).
    setLastPath(pathname);
    setOpen(false);
  }

  const mainCount = main.length;
  const hasMoreGroup = more.length > 0;
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll<HTMLElement>('[data-nav-slot]'));
    const moreSlot = nav.querySelector<HTMLElement>('[data-nav-more]');
    const measure = (): void => {
      if (nav.clientWidth === 0) return; // hidden below lg
      setFits(fitCount(links.map((link) => link.offsetWidth), nav.clientWidth, moreSlot?.offsetWidth ?? 0, hasMoreGroup));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    for (const link of links) observer.observe(link);
    return () => observer.disconnect();
  }, [mainCount, hasMoreGroup]);

  const visible = Math.min(fits, mainCount);
  const overflow = main.slice(visible);
  const showMore = hasMoreGroup || overflow.length > 0;
  const moreActive = [...overflow, ...more].some((entry) => navMatches(entry, pathname));

  if (mainCount === 0 && !hasMoreGroup) return null;
  return (
    <nav ref={navRef} aria-label="Main" data-testid="top-nav" className="relative hidden h-full min-w-0 flex-1 overflow-hidden lg:block">
      <ul className="flex h-full items-center">
        {main.map((entry, index) => {
          const parked = index >= visible;
          return (
            <li key={entry.id} data-nav-slot="" aria-hidden={parked || undefined} className={cn('shrink-0', parked && 'invisible absolute top-0 left-0')}>
              <BarLink entry={entry} badge={badgeFor(entry, badges)} active={navMatches(entry, pathname)} parked={parked} />
            </li>
          );
        })}
        <li data-nav-more="" className={cn('shrink-0', !showMore && 'invisible absolute top-0 left-0')}>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger data-testid="nav-more" data-active={moreActive ? 'true' : undefined} tabIndex={showMore ? undefined : -1} className={triggerClass}>
              More
              <ChevronDown aria-hidden className="size-3.5 opacity-70 transition-transform group-data-[state=open]:rotate-180" />
              <ActiveUnderline show={moreActive} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={2} className="w-60" data-testid="nav-more-menu">
              {overflow.map((entry) => (
                <MenuLink key={entry.id} entry={entry} badge={badgeFor(entry, badges)} active={navMatches(entry, pathname)} />
              ))}
              {overflow.length > 0 && hasMoreGroup ? <DropdownMenuSeparator /> : null}
              {more.map((entry) => (
                <MenuLink key={entry.id} entry={entry} badge={badgeFor(entry, badges)} active={navMatches(entry, pathname)} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ul>
    </nav>
  );
}
