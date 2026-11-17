import Link from 'next/link';
import { cn } from '@/components/ui/cn';

export interface RouteTab {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Count shown after the label (left out when 0 or unknown). */
  readonly count?: number;
}

/**
 * Page level tabs where every tab is its own URL (so a tab can be bookmarked and shared).
 * Same look as the `underline` Tabs variant. Server component: the page passes the active id.
 */
export function RouteTabs({ tabs, active, label }: { readonly tabs: readonly RouteTab[]; readonly active: string; readonly label: string }) {
  return (
    <nav aria-label={label} className="-mb-px overflow-x-auto">
      <ul className="flex min-w-max items-end gap-6 border-b border-border-subtle">
        {tabs.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                data-testid={`tab-${tab.id}`}
                className={cn(
                  'relative -mb-px inline-flex h-9 items-center gap-1.5 rounded-t-sm border-b-2 border-transparent px-0.5 text-sm font-medium whitespace-nowrap text-fg-secondary',
                  'transition-[color,border-color] duration-[var(--duration-fast)] ease-out hover:text-fg',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  current && 'border-primary text-fg',
                )}
              >
                {tab.label}
                {tab.count ? <span className="min-w-5 rounded-full bg-muted px-1.5 text-center text-xs font-semibold text-fg-secondary tabular-nums">{tab.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
