'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { breadcrumbsFor, type Crumb } from '@/config/route-registry';
import { cn } from '@/lib/utils';

export type { Crumb };

/**
 * `Home › …items`. "Home" and crumbs with `href` link; the rest are plain text.
 * Phones (below `md`): the full trail costs a line of the first viewport, so it collapses
 * to a back chevron + the nearest linkable ancestor ("‹ Shipment Orders", else "‹ Home").
 */
export function Breadcrumbs({
  items,
  className,
}: {
  readonly items: readonly Crumb[];
  readonly className?: string;
}) {
  const parent = items
    .slice(0, -1)
    .reverse()
    .find((c) => Boolean(c.href));
  return (
    <nav aria-label="Breadcrumb" className={cn('text-xs text-fg-muted', className)}>
      <Link
        href={parent?.href ?? '/dashboard'}
        className="flex w-fit items-center gap-0.5 rounded font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 md:hidden"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        {parent?.label ?? 'Home'}
      </Link>
      <ol className="hidden flex-wrap items-center gap-1 md:flex">
        <li>
          <Link
            href="/dashboard"
            className="rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
          >
            Home
          </Link>
        </li>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" aria-hidden />
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={last ? 'font-medium text-fg' : undefined}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The route "Home" links to; its own breadcrumb would be self-referential. */
const HOME_PATH = '/dashboard';

/** Breadcrumbs derived from the nav config for the current route. */
export function AutoBreadcrumbs({
  currentLabel,
  className,
}: {
  readonly currentLabel?: string;
  readonly className?: string;
}) {
  const pathname = usePathname();
  const items = React.useMemo(() => breadcrumbsFor(pathname, currentLabel), [pathname, currentLabel]);
  // "Home › Dashboard" on the home route says nothing: suppress the trail there.
  if (pathname === HOME_PATH) return null;
  return <Breadcrumbs items={items} className={className} />;
}
