/** Static copy for the Help Center menu. */

export interface HelpGuide {
  readonly title: string;
  readonly body: string;
  readonly href?: string;
  readonly linkLabel?: string;
}

export const HELP_GUIDES: readonly HelpGuide[] = [
  { title: "Find anything fast", body: "Press / or Ctrl+K to search pages and records: order codes, store order numbers, customers, SKUs, barcodes and clients." },
  { title: "Work in context", body: "Use the warehouse and client switcher in the header to narrow every list to one facility or client. Your choice is remembered on this device." },
  { title: "Background tasks", body: "Exports, imports and bulk operations run in the background. Follow their progress in the Transactions tray and download finished files there.", href: "/reports/export-history", linkLabel: "Open Excel export history" },
  { title: "Direct printing", body: "Assign your barcode and laser printer per warehouse from the Printers icon. Printouts then go straight to the right device." },
  { title: "Your preferences", body: "Choose date, time and number formats used across every grid and summary.", href: "/account/preferences", linkLabel: "Open preferences" },
];

export interface WhatsNewEntry {
  /** Release date shown above the title ("Nov 6, 2026"). */
  readonly date: string;
  readonly version: string;
  readonly tag: string;
  readonly title: string;
  readonly body: string;
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  { date: "Nov 6, 2026", version: "v0.3", tag: "New", title: "Record search", body: "Global search now finds shipment orders, SKUs and clients, not just pages." },
  { date: "Nov 6, 2026", version: "v0.3", tag: "New", title: "Warehouse & client context", body: "Scope the whole app to one warehouse or client from the header." },
  { date: "Oct 22, 2026", version: "v0.2", tag: "Improved", title: "Inline validation", body: "Forms show the exact problem under each field and jump to the first error." },
  { date: "Oct 22, 2026", version: "v0.2", tag: "Improved", title: "Notifications", body: "Wave completions, failed imports and shortages arrive in the bell with deep links." },
];

/** Two-key navigation sequences (see `goto-shortcuts.ts`). */
export interface GotoShortcut {
  readonly key: string;
  readonly href: string;
  readonly description: string;
}

export const GOTO_SHORTCUTS: readonly GotoShortcut[] = [
  { key: "d", href: "/dashboard", description: "Go to Dashboard" },
  { key: "o", href: "/orders", description: "Go to Shipment Orders" },
  { key: "j", href: "/jobs", description: "Go to Jobs" },
  { key: "r", href: "/receiving", description: "Go to Receiving" },
  { key: "i", href: "/inventory", description: "Go to Inventory" },
  { key: "p", href: "/products", description: "Go to Products" },
  { key: "l", href: "/locations", description: "Go to Locations" },
  { key: "c", href: "/clients", description: "Go to Clients" },
  { key: "t", href: "/reports", description: "Go to Reports" },
  { key: "s", href: "/settings", description: "Go to Settings" },
];

/** Grid keyboard behavior (handled by the grid controls themselves). */
const GRID_SHORTCUTS: readonly StaticShortcut[] = [
  { description: "Run the grid search (in the search box)", keys: [["Enter"]], group: "Grids" },
  { description: "Jump to the typed page (in the page box)", keys: [["Enter"]], group: "Grids" },
  { description: "Select or clear the focused row checkbox", keys: [["Space"]], group: "Grids" },
  { description: "Add a column to the sort (click a header)", keys: [["Shift+Click"]], group: "Grids" },
  { description: "Open the focused row's actions menu", keys: [["Enter"], ["Space"]], group: "Grids" },
  { description: "Move between menu items", keys: [["↑"], ["↓"]], group: "Grids" },
];

/** Shortcuts handled outside the registry, listed in the shortcuts sheet. */
export interface StaticShortcut {
  readonly description: string;
  /** Alternatives; each is a list of keys pressed in sequence. */
  readonly keys: readonly (readonly string[])[];
  readonly group: string;
}

export const STATIC_SHORTCUTS: readonly StaticShortcut[] = [
  ...GOTO_SHORTCUTS.map((s) => ({ description: s.description, keys: [["G", s.key.toUpperCase()]], group: "Navigation" })),
  { description: "Close a dialog, menu or drawer", keys: [["Esc"]], group: "General" },
  ...GRID_SHORTCUTS,
];

export interface ShortcutRow {
  readonly description: string;
  readonly combos: readonly string[];
  readonly group: string;
}

/** One row per action: registry entries with the same description merge ("/ or Ctrl K"). */
export function mergeShortcutRows(list: readonly { readonly description: string; readonly combo: string; readonly group: string }[]): readonly ShortcutRow[] {
  const rows: ShortcutRow[] = [];
  for (const s of list) {
    const index = rows.findIndex((r) => r.description === s.description && r.group === s.group);
    const existing = rows[index];
    if (existing) rows[index] = { ...existing, combos: [...existing.combos, s.combo] };
    else rows.push({ description: s.description, combos: [s.combo], group: s.group });
  }
  return rows;
}
