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
  "/reports/inventory-snapshot": "Nightly point-in-time copy of every inventory bucket.",
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

export const REPORT_CATALOG: readonly CatalogGroup[] = (NAV_MENUS.find((m) => m.key === "reports")?.columns ?? []).map((c) => ({
  heading: c.heading,
  icon: c.icon,
  items: c.items.map(toItem(c.heading)),
}));

/** Case-insensitive match on label, description, group and aliases. */
export function matchesReport(item: CatalogItem, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return [item.label, item.description, item.group, ...item.aliases].some((s) => s.toLowerCase().includes(t));
}

/** Grid-prefs key holding the viewer's ★ favorites (`pinned` = hrefs). */
export const REPORT_HUB_PREFS_KEY = "report-hub";
