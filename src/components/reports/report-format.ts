/** Warehouse context shown on report rows (MLT1 is the default warehouse filter). */
export const WAREHOUSE_NAME = "MLT1 – Main Fulfillment";

const DEFAULT_OPERATOR = "M. Alvarez";

const OPERATORS: readonly string[] = [
  DEFAULT_OPERATOR,
  "J. Chen",
  "T. Okafor",
  "S. Reyes",
  "D. Kowalski",
  "A. Haddad",
  "K. Novak",
  "R. Bishop",
];

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Deterministic lot number for a SKU so the column is stable across pages and
 * refetches. Roughly a third of SKUs are not lot-tracked (rendered as "—"),
 * matching how sparsely LP/lot columns populate in real WMS snapshots.
 */
export function lotNumberFor(sku: string): string | null {
  const h = hashString(sku);
  if (h % 3 === 0) return null;
  return `LT-${String(10000 + (h % 90000))}`;
}

/** Deterministic operator attribution for a transaction reference. */
export function operatorFor(reference: string): string {
  const idx = hashString(reference) % OPERATORS.length;
  return OPERATORS[idx] ?? DEFAULT_OPERATOR;
}
