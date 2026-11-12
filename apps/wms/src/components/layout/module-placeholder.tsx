import * as React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Construction, CornerUpLeft } from 'lucide-react';
import { NAV_MENUS } from '@/config/nav-config';
import { isAllowed } from '@/config/nav-access';
import { PAGE_TAB_GROUPS, tabGroupForPath } from '@/config/page-tabs';
import { ROUTE_REGISTRY, type RouteInfo } from '@/config/route-registry';
import { getAuthContext } from '@/server/auth/context';
import { FORBIDDEN_PATH } from '@/server/auth/permissions';
import { EmptyState, type EmptyStateAction } from '@/components/ui/empty-state';
import { SkeletonText } from '@/components/ui/skeleton';
import { PLACEHOLDER_COPY, PLACEHOLDER_TITLE, shipsInLabel } from './module-placeholder-copy';
import { PageHeader } from './page-header';

const MAX_RELATED = 4;

export { PLACEHOLDER_COPY, PLACEHOLDER_TITLE, shipsInLabel };

function routeInfo(route: string): RouteInfo {
  const info = ROUTE_REGISTRY.get(route);
  if (!info) throw new Error(`Route "${route}" is not registered in src/config/route-registry.ts`);
  return info;
}

export function placeholderMetadata(route: string): Metadata {
  return { title: routeInfo(route).label };
}

/** Sibling pages (same tab group, else same mega-menu column) the viewer may open. */
export function relatedRoutes(info: RouteInfo, granted: ReadonlySet<string>): readonly EmptyStateAction[] {
  const group = tabGroupForPath(info.pattern);
  const fromTabs = group
    ? PAGE_TAB_GROUPS[group].map((t) => ({ label: t.label, href: t.href, permission: t.permission }))
    : [];
  const column = NAV_MENUS.flatMap((menu) => menu.columns).find((c) =>
    c.items.some((i) => i.href === info.pattern),
  );
  const fromColumn = column
    ? column.items.map((i) => ({ label: i.label, href: i.href, permission: i.permission }))
    : [];
  const parent = info.parent && info.parent !== '/dashboard' ? ROUTE_REGISTRY.get(info.parent) : undefined;
  const fromParent = parent
    ? [{ label: parent.label, href: parent.pattern, permission: parent.permission }]
    : [];
  const candidates = [...fromParent, ...fromTabs, ...fromColumn].filter(
    (r) => r.href !== info.pattern && !r.href.includes('[') && isAllowed(r.permission, granted),
  );
  const unique = candidates.filter((r, index) => candidates.findIndex((c) => c.href === r.href) === index);
  return unique
    .slice(0, MAX_RELATED)
    .map((r) => ({
      title: r.label,
      href: r.href,
      ...(r.href === parent?.pattern ? { icon: CornerUpLeft, description: 'Back to the list' } : {}),
    }));
}

async function GuardedPlaceholder({ info }: { readonly info: RouteInfo }) {
  const target = info.pattern.includes('[') ? null : encodeURIComponent(info.pattern);
  const auth = await getAuthContext();
  if (!auth) redirect(target ? `/login?next=${target}` : '/login');
  if (!isAllowed(info.permission, auth.permissions))
    redirect(target ? `${FORBIDDEN_PATH}?from=${target}` : FORBIDDEN_PATH);
  return (
    <>
      <PageHeader title={info.label} tabs={tabGroupForPath(info.pattern) ?? undefined} />
      <section
        aria-label={`${info.label} (${PLACEHOLDER_TITLE.toLowerCase()})`}
        data-placeholder=""
        data-placeholder-module={info.owner}
        data-module={info.owner}
        data-route={info.pattern}
        className="px-6 py-6"
      >
        <div className="rounded-xl border border-dashed border-border-strong bg-surface">
          <EmptyState
            icon={Construction}
            title={PLACEHOLDER_TITLE}
            description={
              <>
                <span className="mb-1.5 inline-flex rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-semibold text-primary">
                  {shipsInLabel(info.owner)}
                </span>
                <span className="block">{PLACEHOLDER_COPY}</span>
              </>
            }
            cards={relatedRoutes(info, auth.permissions)}
          />
        </div>
      </section>
    </>
  );
}

/**
 * Shared "Module in progress" page (F8.2) for nav routes whose owning module has not shipped yet.
 * Renders the correct breadcrumb, title and tab strip, and enforces the route's permission.
 */
export function ModulePlaceholder({ route }: { readonly route: string }) {
  const info = routeInfo(route);
  return (
    <React.Suspense
      fallback={
        <div className="px-6 py-6">
          <SkeletonText lines={3} />
        </div>
      }
    >
      <GuardedPlaceholder info={info} />
    </React.Suspense>
  );
}
