/**
 * Settings hub (`/settings`) data: the Settings mega-menu sections, filtered by the
 * viewer's permissions, each item annotated with a one-line description. Pure, so the
 * hub and its unit tests share one source with the nav config.
 */
import { NAV_MENUS, type NavIconName, type NavItem } from "@/config/nav-config";
import { visibleItems, type GrantedPermissions } from "@/config/nav-access";

export const SETTINGS_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "/products": "Item master: SKUs, kits, units of measure and barcodes.",
  "/products/listings": "Channel listings linked to products.",
  "/locations": "Bins, zones and location attributes.",
  "/organization/vendors": "Suppliers used on purchase orders.",
  "/organization/customers": "Ship-to customers and addresses.",
  "/organization/retailers": "Retailer compliance profiles.",
  "/settings/warehouses": "Warehouses, addresses and operating preferences.",
  "/settings/mobile-carts": "Carts and totes for mobile picking.",
  "/settings/lp-types": "License plate (pallet, tote, carton) types.",
  "/settings/lp-numbers": "LP number ranges and generation.",
  "/settings/shipment-packages": "Box and carton sizes for packing.",
  "/settings/printouts": "Label and document templates.",
  "/settings/data-setup/code-generation": "Auto code generation and lookup lists.",
  "/settings/company": "Company profile, security policy and email delivery.",
  "/settings/apps": "Activate add-on apps such as Analytics.",
  "/settings/job-types": "Picking, count, replenishment and work order job types.",
  "/settings/screen-configuration": "Mobile receiving steps and the purchase orders they apply to.",
  "/clients": "3PL clients (depositors) and their settings.",
  "/billing": "3PL billing contracts and invoices.",
  "/billing/reports": "Billable activity by client and period.",
  "/billing/vas": "Value-added service operations.",
  "/settings/users": "Invite users, assign roles, warehouses and clients.",
  "/settings/roles": "Roles and their permission sets.",
  "/settings/audit": "Security and configuration audit trail.",
  "/settings/custom-fields": "Other Info fields on orders, products, LP types, packages and more.",
};

export interface SettingsHubSection {
  readonly heading: string;
  readonly icon: NavIconName;
  readonly items: readonly (NavItem & { readonly description: string })[];
}

/** Extra account-level entries not in the mega-menu columns. */
const EXTRA: readonly { readonly label: string; readonly href: string; readonly permission: string; readonly description: string }[] = [
  { label: "Company Settings", href: "/settings/company", permission: "settings.company_settings.view", description: "Company name, logo, units, currency, date format and security policy." },
  { label: "Apps", href: "/settings/apps", permission: "settings.add_ons.view", description: "Activate add-ons and integrations." },
  { label: "Custom Fields", href: "/settings/custom-fields", permission: "settings.company_settings.view", description: "Other Info fields on orders, products, LP types, packages and more." },
];

export function settingsHubSections(granted: GrantedPermissions): readonly SettingsHubSection[] {
  const menu = NAV_MENUS.find((m) => m.key === "settings");
  const sections: SettingsHubSection[] = (menu?.columns ?? [])
    .map((col) => ({
      heading: col.heading,
      icon: col.icon,
      items: visibleItems(col.items, granted).map((it) => ({ ...it, description: SETTINGS_DESCRIPTIONS[it.href] ?? "" })),
    }))
    .filter((s) => s.items.length > 0);
  const account = EXTRA.filter((e) => granted.has(e.permission)).map((e) => ({
    label: e.label, href: e.href, permission: [e.permission], owner: "M14" as const, description: e.description,
  }));
  if (account.length > 0) sections.push({ heading: "Account", icon: "company", items: account });
  return sections;
}

/** Every permission that would show at least one hub card (used by the page guard). */
export function settingsHubPermissions(): readonly string[] {
  const menu = NAV_MENUS.find((m) => m.key === "settings");
  const keys = new Set<string>(EXTRA.map((e) => e.permission));
  for (const col of menu?.columns ?? []) for (const it of col.items) for (const p of it.permission) keys.add(p);
  return [...keys];
}
