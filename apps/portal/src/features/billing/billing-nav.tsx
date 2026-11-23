'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/ui';

const TABS: readonly { href: string; label: string; match: (path: string) => boolean }[] = [
  { href: '/billing', label: 'Overview', match: (path) => path === '/billing' },
  { href: '/billing/plan', label: 'Plan', match: (path) => path.startsWith('/billing/plan') },
  { href: '/billing/invoices', label: 'Invoices', match: (path) => path.startsWith('/billing/invoices') },
  { href: '/billing/details', label: 'Details', match: (path) => path.startsWith('/billing/details') },
  { href: '/billing/team', label: 'Team', match: (path) => path.startsWith('/billing/team') },
  { href: '/billing/activity', label: 'Activity', match: (path) => path.startsWith('/billing/activity') },
];

/** Focused steps (review, return pages, cancel) show no tabs: one thing to do, one way back. */
const FOCUSED = ['/billing/checkout', '/billing/cancel'];

/** The tabs across the billing area. Shown to people who can see billing. Scrolls sideways on phones. */
export function BillingNav() {
  const pathname = usePathname();
  if (FOCUSED.some((prefix) => pathname.startsWith(prefix))) return null;
  return (
    <nav aria-label="Billing" className="-mx-4 mb-6 overflow-x-auto border-b border-border-subtle px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-11 items-center rounded-t-md px-3 text-sm font-medium',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                  active ? 'text-fg' : 'text-fg-secondary hover:text-fg',
                )}
              >
                {tab.label}
                {active ? <span aria-hidden className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
