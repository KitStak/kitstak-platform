/** Pure helpers for the `/imports` Data Import hub (unit-tested). */
export interface HubImport {
  readonly key: string;
  readonly title: string;
  /** Plural area label ("products", "locations"). */
  readonly area: string;
  readonly href: string;
  readonly configured: boolean;
  readonly columns: number;
}

export interface HubGroup {
  readonly area: string;
  readonly href: string;
  readonly items: readonly HubImport[];
}

/** Groups imports by area, keeping registry order for both groups and items. */
export function groupImports(items: readonly HubImport[]): HubGroup[] {
  const map = new Map<string, { area: string; href: string; items: HubImport[] }>();
  for (const it of items) {
    const g = map.get(it.area) ?? { area: it.area, href: it.href, items: [] };
    g.items.push(it);
    map.set(it.area, g);
  }
  return [...map.values()];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Compact grid-style timestamp: "11/09/2026 11:46 PM". Invalid input passes through. */
export function formatBatchWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${h12}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** Acronyms the registry titles spell in title case ("Bulk Import Vas Operations" → "VAS"). */
const ACRONYMS: Readonly<Record<string, string>> = { vas: "VAS", po: "PO", so: "SO", lp: "LP", lps: "LPs", sku: "SKU", skus: "SKUs", abc: "ABC", upc: "UPC" };

/** Display title with acronyms upper-cased; everything else as registered. */
export function importTitle(title: string): string {
  return title.replace(/\b[A-Za-z]+\b/g, (w) => ACRONYMS[w.toLowerCase()] ?? w);
}

/** Why an import cannot be opened yet (stub handler), or null when it can. */
export function unavailableReason(item: Pick<HubImport, "configured" | "title">): string | null {
  return item.configured ? null : `${importTitle(item.title)} isn't available yet: its import handler hasn't shipped, so uploads would be refused.`;
}
