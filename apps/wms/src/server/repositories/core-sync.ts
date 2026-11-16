/**
 * Write-through sync of WMS business masters into the shared core registry
 * (BLUEPRINT.md §2.4, adapted): wms.clients → core.customers and wms.products
 * (identity fields only) → core.items, in the SAME transaction as the WMS write.
 *
 * Deliberate deviation from the blueprint's "compatibility view" idea: WMS read
 * paths STAY on wms.clients / wms.products. Replacing wms.clients with a view
 * over core.customers would have to reproduce every WMS-only column, break
 * drizzle's table metadata (inserts/updates against a view), and put a shared
 * table in the hot path of 500+ routes. A write-through hook is lower risk: the
 * WMS tables remain the operational source of truth, and core gets an
 * eventually-identical identity copy updated transactionally on every create /
 * update / status change / delete.
 *
 * Id mapping: wms ids are text columns holding uuid strings, and the SAME value
 * is used as the core uuid PK (core.customers.id = wms.clients.id::uuid), so no
 * mapping table is needed. wms.products carries core_item_id (set here) because
 * core.items generates its own PK.
 *
 * Seeds call the bulk variants after building the demo tenant; those also sweep
 * core.customers rows whose wms.clients source no longer exists (re-seeding into
 * a shared database leaves stale rows behind — wipeAllRows only truncates wms.*).
 */
import { and, eq, ne, notInArray } from 'drizzle-orm';
import { customers as coreCustomers, items as coreItems } from '@kitstak/db/schema';
import type { AppDb } from '@/server/api/db';
import { warehouseOrgId } from '@/server/auth/credentials';
import * as s from '@/server/db/schema';

/** Blank-padded WMS text fields become NULL in core (core columns are nullable). */
const opt = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const asJson = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Upserts the core.customers row for one wms.clients row (keyed by the shared
 * uuid). A stale core row holding the same (org_id, code) under a different id
 * (left by an earlier database generation) is removed first so the unique
 * constraint cannot block the upsert.
 */
export async function syncClientToCore(tx: AppDb, clientId: string, orgIdHint?: string): Promise<void> {
  const row = (await tx.select().from(s.clients).where(eq(s.clients.id, clientId)).limit(1))[0];
  if (!row) return;
  const orgId = orgIdHint ?? (await warehouseOrgId(tx));
  await tx
    .delete(coreCustomers)
    .where(
      and(eq(coreCustomers.orgId, orgId), eq(coreCustomers.code, row.code), ne(coreCustomers.id, row.id)),
    );
  const identity = {
    orgId,
    code: row.code,
    name: row.name,
    officialName: opt(row.officialName),
    contactName: opt(row.contactName),
    contactEmail: opt(row.contactEmail),
    phone: opt(row.phone),
    taxId: opt(row.taxId),
    currency: row.currency,
    billingPlan: row.billingPlan,
    status: row.status,
    settings: asJson(row.settings),
    customFields: asJson(row.customFields),
  };
  await tx
    .insert(coreCustomers)
    .values({ id: row.id, ...identity })
    .onConflictDoUpdate({
      target: coreCustomers.id,
      set: { ...identity, updatedAt: new Date() },
    });
}

/** Deletes the core.customers copy of a deleted wms client (core.items cascade). */
export async function removeClientFromCore(tx: AppDb, clientId: string): Promise<void> {
  await tx.delete(coreCustomers).where(eq(coreCustomers.id, clientId));
}

/**
 * Upserts the core.items identity row for one wms.products row and stamps
 * wms.products.core_item_id. The owning core.customers row is created on demand
 * (worlds/fixtures insert wms.clients directly, bypassing the clients repo).
 * Returns the core item id (null when the product does not exist).
 */
export async function syncProductToCore(
  tx: AppDb,
  productId: string,
  orgIdHint?: string,
): Promise<string | null> {
  const row = (await tx.select().from(s.products).where(eq(s.products.id, productId)).limit(1))[0];
  if (!row) return null;
  const orgId = orgIdHint ?? (await warehouseOrgId(tx));
  const customer = (
    await tx
      .select({ id: coreCustomers.id })
      .from(coreCustomers)
      .where(eq(coreCustomers.id, row.clientId))
      .limit(1)
  )[0];
  if (!customer) await syncClientToCore(tx, row.clientId, orgId);
  const identity = {
    orgId,
    customerId: row.clientId,
    sku: row.sku,
    name: row.name,
    barcode: opt(row.barcode),
    uom: row.uom,
    isKit: row.isKit,
    status: row.status,
    category: opt(row.category),
  };
  if (row.coreItemId) {
    const updated = await tx
      .update(coreItems)
      .set({ ...identity, updatedAt: new Date() })
      .where(eq(coreItems.id, row.coreItemId))
      .returning({ id: coreItems.id });
    if (updated[0]) return updated[0].id;
    // The pointed-at row vanished (stale pointer): fall through and re-create it.
  }
  const upserted = (
    await tx
      .insert(coreItems)
      .values(identity)
      .onConflictDoUpdate({
        target: [coreItems.orgId, coreItems.customerId, coreItems.sku],
        set: { ...identity, updatedAt: new Date() },
      })
      .returning({ id: coreItems.id })
  )[0];
  if (row.coreItemId !== upserted.id)
    await tx.update(s.products).set({ coreItemId: upserted.id }).where(eq(s.products.id, productId));
  return upserted.id;
}

/** Deletes the core.items copy of a deleted wms product. */
export async function removeProductFromCore(tx: AppDb, coreItemId: string | null): Promise<void> {
  if (!coreItemId) return;
  await tx.delete(coreItems).where(eq(coreItems.id, coreItemId));
}

/**
 * Seed hook: mirrors EVERY wms client into core.customers and sweeps core rows
 * (this org) whose source client no longer exists; the cascade removes their items.
 */
export async function syncAllClientsToCore(tx: AppDb): Promise<void> {
  const orgId = await warehouseOrgId(tx);
  const ids = (await tx.select({ id: s.clients.id }).from(s.clients)).map((r) => r.id);
  await tx
    .delete(coreCustomers)
    .where(
      ids.length
        ? and(eq(coreCustomers.orgId, orgId), notInArray(coreCustomers.id, ids))
        : eq(coreCustomers.orgId, orgId),
    );
  for (const id of ids) await syncClientToCore(tx, id, orgId);
}

/** Seed hook: mirrors every wms product into core.items (after syncAllClientsToCore). */
export async function syncAllProductsToCore(tx: AppDb): Promise<void> {
  const orgId = await warehouseOrgId(tx);
  const ids = (await tx.select({ id: s.products.id }).from(s.products)).map((r) => r.id);
  for (const id of ids) await syncProductToCore(tx, id, orgId);
}
