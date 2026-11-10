/**
 * Route registry: every KitStaks app route (nav items + tab-only routes + detail/create
 * routes) with label, owner, permission and breadcrumb parent. Breadcrumbs, the
 * "Module in progress" placeholder and the route-coverage test all read from here.
 */
import { DASHBOARD_ITEM, HEADER_ITEMS, NAV_MENUS, NAV_PERMISSIONS as P, USER_MENU_ITEMS, type ModuleOwner, type NavItem } from "./nav-config";

export interface RouteInfo {
  /** Route pattern, e.g. `/orders/[id]`. */
  readonly pattern: string;
  readonly label: string;
  readonly owner: ModuleOwner;
  readonly permission: readonly string[];
  /** Mega-menu label shown as the first crumb ("Fulfillment"); null for top-level pages. */
  readonly section: string | null;
  /** Pattern of the breadcrumb parent page. */
  readonly parent?: string;
}

export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

interface ExtraRoute {
  readonly pattern: string;
  readonly label: string;
  readonly owner: ModuleOwner;
  readonly parent: string;
  readonly permission?: string | readonly string[];
}

/** Tab-only routes and detail/create routes (F4.6 + "Detail and create routes"). */
const EXTRA_ROUTES: readonly ExtraRoute[] = [
  { pattern: "/orders/new", label: "New Shipment Order", owner: "M01", parent: "/orders", permission: "fulfillment.shipment_orders.create" },
  { pattern: "/orders/[id]", label: "Shipment Order Details", owner: "M01", parent: "/orders" },
  { pattern: "/orders/returns/new", label: "New Return Order", owner: "M04", parent: "/orders/returns" },
  { pattern: "/orders/returns/[id]", label: "Return Order Details", owner: "M04", parent: "/orders/returns" },
  { pattern: "/shipment-plans/orders", label: "Shipment Plan Orders", owner: "M02", parent: "/shipment-plans" },
  { pattern: "/shipment-plans/lps", label: "Shipment Plan LPs", owner: "M02", parent: "/shipment-plans" },
  { pattern: "/shipment-plans/[id]", label: "Shipment Plan Details", owner: "M02", parent: "/shipment-plans" },
  { pattern: "/jobs/[id]", label: "Job Details", owner: "M03", parent: "/jobs" },
  { pattern: "/receiving/new", label: "New Purchase Order", owner: "M05", parent: "/receiving", permission: "inventory.purchase_orders.create" },
  { pattern: "/receiving/[id]", label: "Purchase Order Details", owner: "M05", parent: "/receiving" },
  { pattern: "/receiving/vendors", label: "Vendors", owner: "M05", parent: "/receiving", permission: P.vendors },
  { pattern: "/work-orders/[id]", label: "Work Order Details", owner: "M08", parent: "/work-orders" },
  { pattern: "/counts/[id]", label: "Count Plan Details", owner: "M07", parent: "/counts" },
  { pattern: "/products/[id]", label: "Product Details", owner: "M09", parent: "/products" },
  { pattern: "/locations/[id]", label: "Location Details", owner: "M10", parent: "/locations" },
  { pattern: "/clients/[id]", label: "Client Details", owner: "M11", parent: "/clients" },
  { pattern: "/billing/[id]", label: "Billing Form", owner: "M11", parent: "/billing" },
  { pattern: "/billing/reports/[id]", label: "Billing Report Details", owner: "M11", parent: "/billing/reports" },
  { pattern: "/automation/algorithms/putaway", label: "Putaway Algorithm", owner: "M12", parent: "/automation/algorithms" },
  { pattern: "/automation/algorithms/allocation", label: "Allocation Algorithm", owner: "M12", parent: "/automation/algorithms" },
  { pattern: "/automation/algorithms/putaway/new", label: "New Putaway Algorithm", owner: "M12", parent: "/automation/algorithms/putaway" },
  { pattern: "/automation/algorithms/putaway/[id]", label: "Putaway Algorithm Details", owner: "M12", parent: "/automation/algorithms/putaway" },
  { pattern: "/automation/algorithms/allocation/new", label: "New Allocation Algorithm", owner: "M12", parent: "/automation/algorithms/allocation" },
  { pattern: "/automation/algorithms/allocation/[id]", label: "Allocation Algorithm Details", owner: "M12", parent: "/automation/algorithms/allocation" },
  { pattern: "/automation/workflows/new", label: "New Workflow", owner: "M12", parent: "/automation/workflows" },
  { pattern: "/automation/workflows/[id]", label: "Workflow Details", owner: "M12", parent: "/automation/workflows" },
  { pattern: "/integrations/channels/[provider]", label: "Channel Integration", owner: "M12", parent: "/integrations/channels" },
  { pattern: "/integrations/carriers/[provider]", label: "Carrier Integration", owner: "M12", parent: "/integrations/carriers" },
  { pattern: "/integrations/carrier-errors/rate-call", label: "Rate Call Errors", owner: "M12", parent: "/integrations/carrier-errors/label-generation" },
  { pattern: "/integrations/carrier-errors/void-label", label: "Void/Cancel Label Errors", owner: "M12", parent: "/integrations/carrier-errors/label-generation" },
  { pattern: "/reports/serial-numbers/shipment-history", label: "Serial Number Shipment History", owner: "M13", parent: "/reports/serial-numbers" },
  { pattern: "/reports/serial-numbers/receiving-history", label: "Serial Number Receiving History", owner: "M13", parent: "/reports/serial-numbers" },
  { pattern: "/settings/printouts/[type]", label: "Printout List", owner: "M14", parent: "/settings/printouts", permission: "settings.printouts_labels.view" },
  { pattern: "/settings/printouts/[type]/new", label: "Create Printout", owner: "M14", parent: "/settings/printouts/[type]", permission: "settings.printouts_labels.create" },
  { pattern: "/settings/printouts/[type]/[id]", label: "Edit Printout", owner: "M14", parent: "/settings/printouts/[type]", permission: "settings.printouts_labels.edit" },
  { pattern: "/settings/screen-configuration/receiving", label: "Receiving Screen Configuration List", owner: "M14", parent: "/settings/screen-configuration", permission: "settings.screen_configuration.view" },
  { pattern: "/settings/screen-configuration/receiving/new", label: "Create Receiving Configuration", owner: "M14", parent: "/settings/screen-configuration/receiving", permission: "settings.screen_configuration.create" },
  { pattern: "/settings/screen-configuration/receiving/[id]", label: "Edit Receiving Configuration", owner: "M14", parent: "/settings/screen-configuration/receiving", permission: "settings.screen_configuration.edit" },
  { pattern: "/imports/[key]", label: "Import", owner: "Foundation", parent: "/dashboard" },
  { pattern: "/dev/ui", label: "UI Showcase", owner: "Foundation", parent: "/dashboard" },
  { pattern: "/forbidden", label: "Access denied", owner: "Foundation", parent: "/dashboard" },
];

function fromNav(navItem: NavItem, section: string | null): RouteInfo {
  return { pattern: navItem.href, label: navItem.label, owner: navItem.owner, permission: navItem.permission, section };
}

function buildRegistry(): ReadonlyMap<string, RouteInfo> {
  const map = new Map<string, RouteInfo>();
  const add = (info: RouteInfo): void => {
    if (!map.has(info.pattern)) map.set(info.pattern, info);
  };
  add(fromNav(DASHBOARD_ITEM, null));
  for (const menu of NAV_MENUS) {
    for (const column of menu.columns) column.items.forEach((navItem) => add(fromNav(navItem, menu.label)));
    if (menu.footer) add(fromNav(menu.footer, menu.label));
  }
  USER_MENU_ITEMS.forEach((navItem) => add(fromNav(navItem, "Account")));
  HEADER_ITEMS.forEach((navItem) => add(fromNav(navItem, null)));
  for (const extra of EXTRA_ROUTES) {
    const parent = map.get(extra.parent);
    const permission = extra.permission === undefined ? parent?.permission ?? [] : typeof extra.permission === "string" ? [extra.permission] : extra.permission;
    add({ pattern: extra.pattern, label: extra.label, owner: extra.owner, permission, section: parent?.section ?? null, parent: extra.parent });
  }
  return map;
}

export const ROUTE_REGISTRY: ReadonlyMap<string, RouteInfo> = buildRegistry();

/** Every registered route pattern (static and dynamic). */
export const ROUTE_PATTERNS: readonly string[] = Object.freeze([...ROUTE_REGISTRY.keys()]);

const DYNAMIC_SEGMENT = /^\[[^\]/]+\]$/;

function segmentsOf(path: string): string[] {
  return path.split("?")[0]?.split("/").filter(Boolean) ?? [];
}

/** True when `pathname` matches `pattern` (`[x]` matches exactly one segment). */
export function matchesPattern(pattern: string, pathname: string): boolean {
  const want = segmentsOf(pattern);
  const got = segmentsOf(pathname);
  return want.length === got.length && want.every((segment, i) => DYNAMIC_SEGMENT.test(segment) || segment === got[i]);
}

function dynamicCount(pattern: string): number {
  return segmentsOf(pattern).filter((s) => DYNAMIC_SEGMENT.test(s)).length;
}

/** Exact route for a pathname; static routes win over dynamic ones. */
export function resolveRoute(pathname: string): RouteInfo | null {
  const clean = `/${segmentsOf(pathname).join("/")}`;
  const exact = ROUTE_REGISTRY.get(clean);
  if (exact) return exact;
  const candidates = ROUTE_PATTERNS.filter((p) => matchesPattern(p, clean)).sort((a, b) => dynamicCount(a) - dynamicCount(b));
  const first = candidates[0];
  return first ? ROUTE_REGISTRY.get(first) ?? null : null;
}

/** Nearest registered route at or above `pathname` (`/orders/x/edit` → `/orders/[id]`). */
export function resolveNearestRoute(pathname: string): RouteInfo | null {
  const segments = segmentsOf(pathname);
  for (let length = segments.length; length > 0; length -= 1) {
    const hit = resolveRoute(`/${segments.slice(0, length).join("/")}`);
    if (hit) return hit;
  }
  return null;
}

/** Substitutes concrete segments from `pathname` into a parent pattern (parents are static today). */
function hrefFor(pattern: string, pathname: string): string {
  const got = segmentsOf(pathname);
  return `/${segmentsOf(pattern).map((segment, i) => (DYNAMIC_SEGMENT.test(segment) ? got[i] ?? segment : segment)).join("/")}`;
}

const MAX_PARENT_DEPTH = 6;

/**
 * Breadcrumbs (excluding "Home"): `<Menu> › <parent pages…> › <page>`. Menu crumbs are
 * plain text (Logiwa parity); parents link; the current page is plain text.
 */
export function breadcrumbsFor(pathname: string, currentLabel?: string): readonly Crumb[] {
  const route = resolveNearestRoute(pathname);
  if (!route) return currentLabel ? [{ label: currentLabel }] : [];
  const chain: RouteInfo[] = [route];
  let cursor = route;
  while (cursor.parent && chain.length < MAX_PARENT_DEPTH) {
    const parent = ROUTE_REGISTRY.get(cursor.parent);
    if (!parent || parent.pattern === "/dashboard") break;
    chain.unshift(parent);
    cursor = parent;
  }
  const crumbs: Crumb[] = route.section ? [{ label: route.section }] : [];
  chain.forEach((info, index) => {
    const isLast = index === chain.length - 1;
    crumbs.push(isLast ? { label: currentLabel ?? info.label } : { label: info.label, href: hrefFor(info.pattern, pathname) });
  });
  return crumbs;
}

/** Label for a `?from=` / `?next=` param; only registered app routes are echoed back. */
export function routeLabelFromParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return resolveRoute(raw)?.label ?? null;
}
