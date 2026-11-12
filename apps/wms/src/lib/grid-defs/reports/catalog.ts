/**
 * Report Hub catalog (BUILD_PLAN M13 §2): built from the Reports mega-menu in
 * `nav-config` (F4.7) so the hub, the menu and global search never drift. Only the
 * descriptions live here. PURE.
 */
import { NAV_MENUS, type NavIconName, type NavItem } from "@/config/nav-config";

export const REPORT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "/reports/channel-sales": "Demand and revenue per product, channel and store, from shipped orders.",
  "/shipments/history": "Every shipped package with carrier, service, tracking and cost.",
  "/jobs/shortage": "Order lines that could not be allocated, with the stock they are waiting for.",
  "/inventory/atp": "What you can promise per SKU today and once open POs arrive.",
  "/inventory/kits": "Kits on hand and how many more you can build from components.",
  "/inventory/kit-components": "Component availability for every kit, with the limiting part.",
  "/reports/serial-numbers": "Primary and secondary serial status, plus shipment and receiving history.",
  "/reports/order-inventory": "Where the stock allocated to open orders sits: location, LP, lot and status.",
  "/reports/replenishment": "How much to move from reserve into pick faces to cover demand.",
  "/reports/inventory-snapshot": "Daily 00:02 point-in-time copy of every inventory bucket.",
  "/reports/change-log": "Who changed what, from which value to which, with links to the record.",
  "/reports/transaction-history": "The inventory ledger: every move with its before and after state.",
  "/integrations/logs/history": "Channel downloads and syncs with their success and error counts.",
  "/reports/missing-log": "Stock reported missing during picking: where, when and by whom.",
  "/reports/transaction-history/serial": "Every ledger transaction that moved a serial-tracked unit.",
  "/jobs/allocation-exceptions": "Wave allocations that failed and why.",
  "/jobs/wave-log": "Every wave run with orders met, shortages and jobs created.",
  "/reports/export-history": "Your Excel exports with status, row count and download.",
  "/reports/po-receiving": "Received versus ordered quantity per PO line, with difference pills.",
  "/receiving/history": "Every receipt line with location, LP, lot and receiving user.",
  "/reports/user-performance": "Picks, packs, receipts, counts and returns per user per day.",
  "/reports/inventory-aging": "How long on-hand stock has sat, bucketed 0-30 through over 365 days.",
  "/reports/location-utilization": "Units and SKUs per location against its capacity, with over-full and empty bins.",
  "/reports/order-lines": "Every open and shipped-today order line with its pick and pack progress (the dashboard's Order Lines drilldown).",
  "/analytics/labor/average-task": "Average time per task type over time, by job type and client.",
  "/analytics/labor/associate-task": "Tasks and time per associate, split by task type.",
  "/analytics/labor/performance-quadrant": "Speed versus volume per associate, plotted in four quadrants.",
  "/analytics/labor/associate": "One associate's throughput and trend.",
  "/analytics/labor/receiving-performance": "Units and lines received per user and day.",
  "/analytics/operational/inbound-inventory": "Open receipts, dock-to-stock and inventory health at a glance.",
  "/analytics/operational/fulfillment": "Orders by status, shipping performance and backlog.",
  "/analytics/operational/management": "Daily volumes and service levels for warehouse managers.",
  "/analytics/operational/productivity": "Throughput by task, user and hour.",
};

export interface CatalogGroup {
  readonly heading: string;
  readonly icon: NavIconName;
  readonly items: readonly CatalogItem[];
}

export interface CatalogItem {
  readonly label: string;
  readonly href: string;
  readonly permission: readonly string[];
  readonly description: string;
  readonly group: string;
  readonly aliases: readonly string[];
}

const toItem = (group: string) => (n: NavItem): CatalogItem => ({
  label: n.label,
  href: n.href,
  permission: n.permission,
  description: REPORT_DESCRIPTIONS[n.href] ?? "",
  group,
  aliases: n.aliases ?? [],
});

const menuGroups = (key: string): readonly CatalogGroup[] => (NAV_MENUS.find((m) => m.key === key)?.columns ?? []).map((c) => ({
  heading: c.heading,
  icon: c.icon,
  items: c.items.map(toItem(c.heading)),
}));

/** Analytics dashboards (Labor + Operational); also drives the /analytics landing pages. */
export const ANALYTICS_CATALOG: readonly CatalogGroup[] = menuGroups("analytics");

/**
 * M13 analysis reports not yet in the Reports mega-menu (nav-config is foundation-owned;
 * menu entries requested in docs/requests/reports-analytics.md). Skipped once the menu has them.
 */
const ANALYSIS_ITEMS: readonly Omit<CatalogItem, "description" | "group">[] = [
  { label: "Inventory Aging Report", href: "/reports/inventory-aging", permission: ["inventory.total_inventory.view"], aliases: ["aging", "slow movers", "stock age"] },
  { label: "Location Utilization Report", href: "/reports/location-utilization", permission: ["settings.locations.view"], aliases: ["capacity", "utilization", "space"] },
  { label: "Order Line Progress", href: "/reports/order-lines", permission: ["fulfillment.shipment_orders.view"], aliases: ["order lines", "picked", "packed", "line progress"] },
];

export function analysisGroup(existing: readonly CatalogGroup[]): readonly CatalogGroup[] {
  const known = new Set(existing.flatMap((g) => g.items.map((i) => i.href)));
  const heading = "Inventory Analysis";
  const items = ANALYSIS_ITEMS.filter((i) => !known.has(i.href)).map((i) => ({ ...i, group: heading, description: REPORT_DESCRIPTIONS[i.href] ?? "" }));
  // Its own icon (Activity): it must not reuse the Orders cart of the first menu column.
  const icon: NavIconName = "monitoring";
  return items.length > 0 && existing.length > 0 ? [{ heading, icon, items }] : [];
}

const REPORT_MENU_GROUPS = menuGroups("reports");

/** Reports menu columns, the analysis reports, then the Analytics columns, so the hub indexes all. */
export const REPORT_CATALOG: readonly CatalogGroup[] = [...REPORT_MENU_GROUPS, ...analysisGroup(REPORT_MENU_GROUPS), ...ANALYTICS_CATALOG];

/** Case-insensitive match on label, description, group and aliases. */
export function matchesReport(item: CatalogItem, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return [item.label, item.description, item.group, ...item.aliases].some((s) => s.toLowerCase().includes(t));
}

/** Grid-prefs key holding the viewer's ★ favorites (`pinned` = hrefs). */
export const REPORT_HUB_PREFS_KEY = "report-hub";
