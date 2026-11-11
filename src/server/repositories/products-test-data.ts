/**
 * Demo-data hygiene (REQ-25). Critic and e2e runs leave products and channel listings behind
 * whose SKU starts with a test prefix (KS-CRIT-, KS-E2E-). Before a buyer demo they are removed:
 * - products that pass the normal delete guard are deleted (listings unlinked, change-log row);
 * - products the guard keeps (stock, open orders, history) are deactivated instead, so the ledger
 *   stays intact and the default Active view no longer shows them;
 * - listings whose seller SKU carries a test prefix are deleted.
 * `planTestDataPurge` is the dry run; `purgeTestCatalogData` applies it inside the caller's transaction.
 */
import { and, eq, inArray, ilike, lt, or } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { schema } from "@/server/db";
import { deleteBlockerFor, deleteProduct, setProductStatus, type ScopedCtx } from "./products-commands";

const { products: p, productListings: pl } = schema;

export const TEST_SKU_PREFIXES: readonly string[] = ["KS-CRIT-", "KS-E2E-"];

export function isTestSku(sku: string, prefixes: readonly string[] = TEST_SKU_PREFIXES): boolean {
  const s = sku.trim().toUpperCase();
  return prefixes.some((x) => s.startsWith(x.toUpperCase()));
}

export type TestDataPlan = {
  readonly deletable: readonly { readonly id: string; readonly sku: string }[];
  readonly deactivate: readonly { readonly id: string; readonly sku: string; readonly reason: string }[];
  readonly keptInactive: readonly { readonly id: string; readonly sku: string; readonly reason: string }[];
  readonly listingIds: readonly string[];
};

export interface PurgeOptions {
  /** ISO time: only records created before it (skips fixtures a running critic or e2e suite still uses). */
  readonly createdBefore?: string;
  /** Delete what the guard allows, but do not deactivate guarded products (other modules' open orders may still use them). */
  readonly deleteOnly?: boolean;
}

function prefixWhere<T extends typeof p.sku | typeof pl.sellerSku>(col: T, prefixes: readonly string[]) {
  return or(...prefixes.map((x) => ilike(col, `${x}%`)));
}

export async function planTestDataPurge(tx: AppDb, prefixes: readonly string[] = TEST_SKU_PREFIXES, opts: PurgeOptions = {}): Promise<TestDataPlan> {
  if (prefixes.length === 0) return { deletable: [], deactivate: [], keptInactive: [], listingIds: [] };
  const rows = (await tx.select({ id: p.id, sku: p.sku, status: p.status }).from(p).where(and(prefixWhere(p.sku, prefixes), opts.createdBefore ? lt(p.createdAt, opts.createdBefore) : undefined)))
    .filter((r) => isTestSku(r.sku, prefixes));
  const deletable: { id: string; sku: string }[] = [];
  const deactivate: { id: string; sku: string; reason: string }[] = [];
  const keptInactive: { id: string; sku: string; reason: string }[] = [];
  // Kits first: deleting a kit frees its components from the "Component of kit" guard.
  const kitIds = new Set((await tx.select({ id: schema.kitComponents.kitProductId }).from(schema.kitComponents)).map((r) => r.id));
  const ordered = [...rows].sort((a, b) => Number(kitIds.has(b.id)) - Number(kitIds.has(a.id)));
  const willDelete = new Set<string>();
  for (const r of ordered) {
    const reason = await blockerIgnoring(tx, r.id, willDelete);
    if (!reason) { deletable.push({ id: r.id, sku: r.sku }); willDelete.add(r.id); }
    else if (r.status === "Active") deactivate.push({ id: r.id, sku: r.sku, reason });
    else keptInactive.push({ id: r.id, sku: r.sku, reason });
  }
  const listingIds = (await tx.select({ id: pl.id, sku: pl.sellerSku }).from(pl).where(and(prefixWhere(pl.sellerSku, prefixes), opts.createdBefore ? lt(pl.createdAt, opts.createdBefore) : undefined)))
    .filter((r) => isTestSku(r.sku, prefixes)).map((r) => r.id);
  return { deletable, deactivate, keptInactive, listingIds };
}

/** The normal delete guard, except "component of kit" where every such kit is itself being deleted. */
async function blockerIgnoring(tx: AppDb, id: string, willDelete: ReadonlySet<string>): Promise<string | null> {
  const reason = await deleteBlockerFor(tx, id);
  if (!reason?.startsWith("Component of kit")) return reason;
  const kits = await tx.select({ kit: schema.kitComponents.kitProductId }).from(schema.kitComponents).where(eq(schema.kitComponents.componentProductId, id));
  return kits.every((k) => willDelete.has(k.kit)) ? null : reason;
}

export async function purgeTestCatalogData(tx: AppDb, ctx: ScopedCtx, prefixes: readonly string[] = TEST_SKU_PREFIXES, opts: PurgeOptions = {}): Promise<TestDataPlan> {
  const plan = await planTestDataPurge(tx, prefixes, opts);
  if (plan.listingIds.length) await tx.delete(pl).where(inArray(pl.id, [...plan.listingIds]));
  for (const r of plan.deletable) {
    await tx.delete(schema.kitComponents).where(eq(schema.kitComponents.kitProductId, r.id));
    await deleteProduct(tx, ctx, r.id);
  }
  if (opts.deleteOnly) return { ...plan, deactivate: [] };
  for (const r of plan.deactivate) await setProductStatus(tx, ctx, r.id, "Inactive");
  return plan;
}
