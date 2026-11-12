/**
 * Permission filtering and active-state helpers for the nav config. Pure functions shared
 * by the shell (client) and tests.
 */
import type { NavItem, NavMenu } from './nav-config';
import type { PageTab } from './page-tabs';
import { resolveNearestRoute } from './route-registry';

export type GrantedPermissions = ReadonlySet<string>;

/** Any-of check; an empty requirement is visible to everyone. */
export function isAllowed(permission: readonly string[], granted: GrantedPermissions): boolean {
  return permission.length === 0 || permission.some((key) => granted.has(key));
}

/** Active add-on app keys; `null` / omitted = do not gate on apps. */
export type ActiveApps = ReadonlySet<string> | null | undefined;

/** True unless the item belongs to an add-on app that is known to be inactive. */
export function isAppEnabled(navItem: Pick<NavItem, 'app'>, activeApps: ActiveApps): boolean {
  return !navItem.app || !activeApps || activeApps.has(navItem.app);
}

export function visibleItems(
  items: readonly NavItem[],
  granted: GrantedPermissions,
  activeApps?: ActiveApps,
): readonly NavItem[] {
  return items.filter(
    (navItem) => isAllowed(navItem.permission, granted) && isAppEnabled(navItem, activeApps),
  );
}

/**
 * Menus with forbidden items (and items of inactive add-on apps, when `activeApps` is given)
 * removed; empty columns and empty menus are dropped.
 */
export function visibleMenus(
  menus: readonly NavMenu[],
  granted: GrantedPermissions,
  activeApps?: ActiveApps,
): readonly NavMenu[] {
  return menus
    .map((menu): NavMenu => {
      const columns = menu.columns
        .map((column) => ({ ...column, items: visibleItems(column.items, granted, activeApps) }))
        .filter((column) => column.items.length > 0);
      const footer = menu.footer && isAllowed(menu.footer.permission, granted) ? menu.footer : undefined;
      return { key: menu.key, label: menu.label, columns, ...(footer ? { footer } : {}) };
    })
    .filter((menu) => menu.columns.length > 0);
}

export function visibleTabs(tabs: readonly PageTab[], granted: GrantedPermissions): readonly PageTab[] {
  return tabs.filter((t) => isAllowed(t.permission, granted));
}

function pathOf(href: string): string {
  return href.split('?')[0] ?? href;
}

/** True when `pathname` is the item's route or one of its sub-routes. */
export function isItemActive(navItem: Pick<NavItem, 'href'>, pathname: string): boolean {
  const base = pathOf(navItem.href);
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * The single item of `menu` to highlight for `pathname`: the matching item with the longest route,
 * so /billing/reports/[id] highlights "Billing Report" only, not also "3PL Billing" (/billing).
 */
export function activeItemHref(menu: Pick<NavMenu, 'columns'>, pathname: string): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const column of menu.columns) {
    for (const navItem of column.items) {
      const base = pathOf(navItem.href);
      if (isItemActive(navItem, pathname) && base.length > bestLen) {
        best = navItem.href;
        bestLen = base.length;
      }
    }
  }
  return best;
}

/** The menu owning the current route (registry section first, then href prefix). */
/** Hub routes whose tabs span several mega-menus but always belong to one top-nav section (R2-1). */
const HUB_SECTIONS: readonly { readonly prefix: string; readonly menuKey: string }[] = [
  { prefix: '/jobs', menuKey: 'fulfillment' },
  { prefix: '/tasks', menuKey: 'fulfillment' },
  // Analytics landing pages (/analytics, /analytics/labor, /analytics/operational) belong to Analytics.
  { prefix: '/analytics', menuKey: 'analytics' },
];

export function activeMenuKey(menus: readonly NavMenu[], pathname: string): string | null {
  const hub = HUB_SECTIONS.find((h) => pathname === h.prefix || pathname.startsWith(`${h.prefix}/`));
  const hubMenu = hub ? menus.find((menu) => menu.key === hub.menuKey) : undefined;
  if (hubMenu) return hubMenu.key;
  const section = resolveNearestRoute(pathname)?.section;
  const bySection = menus.find((menu) => menu.label === section);
  if (bySection) return bySection.key;
  const byPrefix = menus.find((menu) =>
    menu.columns.some((column) => column.items.some((navItem) => isItemActive(navItem, pathname))),
  );
  if (byPrefix) return byPrefix.key;
  // Account-level settings pages (Company, Apps, ...) live outside the mega-menu columns but still belong to Settings.
  if (
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/account' ||
    pathname.startsWith('/account/')
  )
    return menus.find((menu) => menu.key === 'settings')?.key ?? null;
  return null;
}
