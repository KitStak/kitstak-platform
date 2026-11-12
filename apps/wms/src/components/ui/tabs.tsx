'use client';

/**
 * Tab family (BUILD_PLAN F4.2):
 *   UnderlineTabs   in-page tabs (state), arrow-key navigation, optional counts
 *   PageTabs        route-based tab strip (each tab is a real URL → deep links)
 *   SegmentedTabs   compact pill group for view switches
 *   VerticalNav     left sub-navigation (links or state)
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export interface TabItem {
  readonly key: string;
  readonly label: React.ReactNode;
  readonly count?: number;
  readonly disabled?: boolean;
  readonly icon?: React.ComponentType<{ className?: string }>;
}

function CountBadge({ count, active }: { readonly count: number; readonly active: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums',
        active ? 'bg-pressed text-fg' : 'bg-muted text-fg-secondary',
      )}
    >
      {count}
    </span>
  );
}

/** The strip draws its baseline as an inset shadow so the 2px active underline
 * paints over it without overflowing the box (no native vertical scrollbar). */
/**
 * Radix focuses a trigger on mouse down and Chrome then matches `:focus-visible`, so a ring
 * stays on a clicked tab. Mark pointer-initiated focus and hide the ring for it; keyboard focus
 * keeps the ring.
 */
const pointerFocusProps = {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.dataset.pointer = '';
  },
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
    delete e.currentTarget.dataset.pointer;
  },
  onBlur: (e: React.FocusEvent<HTMLElement>) => {
    delete e.currentTarget.dataset.pointer;
  },
} as const;

const underlineTrigger =
  'inline-flex items-center gap-1.5 border-b-2 pb-2 pt-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/40 focus-visible:rounded-sm data-[pointer]:ring-0 disabled:cursor-not-allowed disabled:opacity-50';

export function UnderlineTabs({
  tabs,
  active,
  onChange,
  className,
  ariaLabel,
}: {
  readonly tabs: readonly TabItem[];
  readonly active: string;
  readonly onChange: (key: string) => void;
  readonly className?: string;
  readonly ariaLabel?: string;
}) {
  return (
    <TabsPrimitive.Root value={active} onValueChange={onChange} activationMode="manual">
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className={cn(
          'flex items-center gap-6 overflow-x-auto overflow-y-hidden px-6 shadow-[inset_0_-1px_0_var(--border-subtle)]',
          className,
        )}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          const Icon = tab.icon;
          return (
            <TabsPrimitive.Trigger
              key={tab.key}
              value={tab.key}
              disabled={tab.disabled}
              {...pointerFocusProps}
              className={cn(
                underlineTrigger,
                isActive
                  ? 'border-primary text-fg'
                  : 'border-transparent text-fg-secondary hover:border-border-strong hover:text-fg',
              )}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
              {tab.label}
              {typeof tab.count === 'number' ? <CountBadge count={tab.count} active={isActive} /> : null}
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

export interface PageTabItem {
  readonly href: string;
  readonly label: React.ReactNode;
  readonly count?: number;
  /** Extra path prefixes that also mark this tab active (e.g. detail routes). */
  readonly match?: readonly string[];
  /** Exact match only (for an index tab that is a prefix of siblings). */
  readonly exact?: boolean;
}

/** Longest matching href wins, so `/jobs` does not stay active on `/jobs/waves`. */
export function activePageTab(tabs: readonly PageTabItem[], pathname: string): string | null {
  let best: { href: string; length: number } | null = null;
  for (const tab of tabs) {
    const candidates = [tab.href.split('?')[0] ?? tab.href, ...(tab.match ?? [])];
    for (const candidate of candidates) {
      const hit = tab.exact
        ? pathname === candidate
        : pathname === candidate || pathname.startsWith(`${candidate}/`);
      if (hit && (!best || candidate.length > best.length))
        best = { href: tab.href, length: candidate.length };
    }
  }
  return best?.href ?? null;
}

export function PageTabs({
  tabs,
  className,
  ariaLabel = 'Page sections',
}: {
  readonly tabs: readonly PageTabItem[];
  readonly className?: string;
  readonly ariaLabel?: string;
}) {
  const pathname = usePathname();
  const activeHref = activePageTab(tabs, pathname);
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        'flex items-center gap-6 overflow-x-auto overflow-y-hidden px-6 shadow-[inset_0_-1px_0_var(--border-subtle)]',
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              underlineTrigger,
              isActive
                ? 'border-primary text-fg'
                : 'border-transparent text-fg-secondary hover:border-border-strong hover:text-fg',
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' ? <CountBadge count={tab.count} active={isActive} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function SegmentedTabs({
  tabs,
  active,
  onChange,
  size = 'md',
  className,
  ariaLabel,
}: {
  readonly tabs: readonly TabItem[];
  readonly active: string;
  readonly onChange: (key: string) => void;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
  readonly ariaLabel?: string;
}) {
  return (
    <TabsPrimitive.Root value={active} onValueChange={onChange}>
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className={cn('inline-flex items-center gap-0.5 rounded-md bg-sunken p-0.5', className)}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsPrimitive.Trigger
              key={tab.key}
              value={tab.key}
              disabled={tab.disabled}
              {...pointerFocusProps}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm font-medium whitespace-nowrap text-fg-secondary transition-[color,background-color,box-shadow] outline-none',
                'hover:text-body focus-visible:ring-2 focus-visible:ring-focus/40 data-[pointer]:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
                'data-[state=active]:bg-raised data-[state=active]:text-fg data-[state=active]:shadow-xs data-[state=active]:ring-1 data-[state=active]:ring-[color:var(--segment-ring)]',
                size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-3 text-sm',
              )}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
              {tab.label}
              {typeof tab.count === 'number' ? (
                <span className="text-2xs tabular-nums text-secondary">{tab.count}</span>
              ) : null}
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

export interface VerticalNavItem {
  readonly key: string;
  readonly label: React.ReactNode;
  readonly href?: string;
  readonly count?: number;
  readonly icon?: React.ComponentType<{ className?: string }>;
}

const verticalItem =
  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus/30';

export function VerticalNav({
  items,
  active,
  onChange,
  className,
  ariaLabel = 'Section navigation',
}: {
  readonly items: readonly VerticalNavItem[];
  /** Active key; when omitted and items have hrefs, the pathname decides. */
  readonly active?: string;
  readonly onChange?: (key: string) => void;
  readonly className?: string;
  readonly ariaLabel?: string;
}) {
  const pathname = usePathname();
  const routeActive = activePageTab(
    items.flatMap((i) => (i.href ? [{ href: i.href, label: i.label }] : [])),
    pathname,
  );
  return (
    <nav aria-label={ariaLabel} className={cn('flex w-full flex-col gap-0.5', className)}>
      {items.map((item) => {
        const isActive = active !== undefined ? item.key === active : item.href === routeActive;
        const Icon = item.icon;
        const classes = cn(
          verticalItem,
          isActive
            ? 'bg-neutral-soft font-semibold text-foreground'
            : 'text-secondary hover:bg-surface-sunken hover:text-body',
        );
        const content = (
          <>
            {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
            <span className="flex-1 truncate">{item.label}</span>
            {typeof item.count === 'number' ? <CountBadge count={item.count} active={isActive} /> : null}
          </>
        );
        return item.href ? (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={classes}
            onClick={() => onChange?.(item.key)}
          >
            {content}
          </Link>
        ) : (
          <button
            key={item.key}
            type="button"
            aria-current={isActive ? 'true' : undefined}
            className={classes}
            onClick={() => onChange?.(item.key)}
          >
            {content}
          </button>
        );
      })}
    </nav>
  );
}
