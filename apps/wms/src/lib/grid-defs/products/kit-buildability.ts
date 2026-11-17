/**
 * Kit buildability (M09). How many complete kits the available component stock covers, and
 * which component limits it. Pure, so the detail Components tab and tests share one rule.
 */

export interface KitComponentStock {
  readonly id: string;
  readonly sku: string;
  readonly quantity: number;
  readonly available: number;
}

/** Whole kits one component line covers (negative stock counts as zero; qty < 1 counts as 1). */
export function buildableFromComponent(c: Pick<KitComponentStock, 'quantity' | 'available'>): number {
  return Math.floor(Math.max(0, c.available) / Math.max(1, c.quantity));
}

export interface KitBuildability<T extends KitComponentStock = KitComponentStock> {
  /** Overall buildable kits: the minimum across components (0 with no components). */
  readonly buildable: number;
  /** Components that cap the total (several when they tie). Empty with no components. */
  readonly limiting: readonly T[];
  /** Units of the first limiting component needed to build one more kit. */
  readonly shortForNext: number;
}

export function kitBuildability<T extends KitComponentStock>(components: readonly T[]): KitBuildability<T> {
  if (components.length === 0) return { buildable: 0, limiting: [], shortForNext: 0 };
  const per = components.map((c) => ({ c, kits: buildableFromComponent(c) }));
  const buildable = Math.min(...per.map((p) => p.kits));
  const limiting = per.filter((p) => p.kits === buildable).map((p) => p.c);
  const first = limiting[0];
  const shortForNext = first
    ? Math.max(0, (buildable + 1) * Math.max(1, first.quantity) - Math.max(0, first.available))
    : 0;
  return { buildable, limiting, shortForNext };
}

/** Above this many limiting components the summary counts them instead of naming each one. */
export const MAX_NAMED_LIMITING = 3;

/** What the buildability summary says about the component(s) capping the kit. */
export type KitLimitSummary<T extends KitComponentStock = KitComponentStock> =
  | { readonly kind: 'none' }
  /** Every component ties, so none stands out as the limit. */
  | { readonly kind: 'all'; readonly total: number }
  | { readonly kind: 'single'; readonly component: T; readonly shortForNext: number }
  | { readonly kind: 'named'; readonly components: readonly T[] }
  | { readonly kind: 'counted'; readonly count: number; readonly total: number };

export function kitLimitSummary<T extends KitComponentStock>(components: readonly T[]): KitLimitSummary<T> {
  const { limiting, shortForNext } = kitBuildability(components);
  const first = limiting[0];
  if (!first) return { kind: 'none' };
  if (limiting.length === 1) return { kind: 'single', component: first, shortForNext };
  if (limiting.length === components.length) return { kind: 'all', total: components.length };
  if (limiting.length <= MAX_NAMED_LIMITING) return { kind: 'named', components: limiting };
  return { kind: 'counted', count: limiting.length, total: components.length };
}
