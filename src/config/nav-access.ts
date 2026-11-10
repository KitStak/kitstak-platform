/**
 * Permission filtering and active-state helpers for the nav config. Pure functions shared
 * by the shell (client) and tests.
 */
import type { NavItem, NavMenu } from "./nav-config";
import type { PageTab } from "./page-tabs";
import { resolveNearestRoute } from "./route-registry";

export type GrantedPermissions = ReadonlySet<string>;

/** Any-of check; an empty requirement is visible to everyone. */
export function isAllowed(permission: readonly string[], granted: GrantedPermissions): boolean {
  return permission.length === 0 || permission.some((key) => granted.has(key));
}

export function visibleItems(items: readonly NavItem[], granted: GrantedPermissions): readonly NavItem[] {
  return items.filter((navItem) => isAllowed(navItem.permission, granted));
}

/** Menus with forbidden items removed; empty columns and empty menus are dropped. */
export function visibleMenus(menus: readonly NavMenu[], granted: GrantedPermissions): readonly NavMenu[] {
  return menus
    .map((menu): NavMenu => {
      const columns = menu.columns
        .map((column) => ({ ...column, items: visibleItems(column.items, granted) }))
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
  return href.split("?")[0] ?? href;
}

/** True when `pathname` is the item's route or one of its sub-routes. */
export function isItemActive(navItem: Pick<NavItem, "href">, pathname: string): boolean {
  const base = pathOf(navItem.href);
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** The menu owning the current route (registry section first, then href prefix). */
export function activeMenuKey(menus: readonly NavMenu[], pathname: string): string | null {
  const section = resolveNearestRoute(pathname)?.section;
  const bySection = menus.find((menu) => menu.label === section);
  if (bySection) return bySection.key;
  const byPrefix = menus.find((menu) => menu.columns.some((column) => column.items.some((navItem) => isItemActive(navItem, pathname))));
  return byPrefix?.key ?? null;
}
