/**
 * Manual entitlement writes. With Stripe integration deferred (owner decision), these
 * upserts are the ONLY production write path into `core.entitlements`; the grant CLI
 * (`scripts/grant.ts`) wraps them per org slug.
 */
import { entitlements, type EntitlementSource, type EntitlementStatus } from '@kitstak/db/schema';
import type { EntitlementsDb } from './db';
import type { Module } from './modules';
import { clearEntitlementsCache } from './read';

async function upsertEntitlement(
  db: EntitlementsDb,
  orgId: string,
  module: Module,
  status: EntitlementStatus,
  source: EntitlementSource,
): Promise<void> {
  await db
    .insert(entitlements)
    .values({ orgId, module, status, source })
    .onConflictDoUpdate({
      target: [entitlements.orgId, entitlements.module],
      set: { status, source, updatedAt: new Date() },
    });
  // The writer's own process must see the new state immediately; other processes
  // converge within the 60s TTL.
  clearEntitlementsCache(orgId);
}

/** Grants a module to an org (upsert → `active`). */
export async function grantModule(
  db: EntitlementsDb,
  orgId: string,
  module: Module,
  source: EntitlementSource = 'manual',
): Promise<void> {
  await upsertEntitlement(db, orgId, module, 'active', source);
}

/** Revokes a module from an org (upsert → `canceled`; the row is kept as history). */
export async function revokeModule(
  db: EntitlementsDb,
  orgId: string,
  module: Module,
  source: EntitlementSource = 'manual',
): Promise<void> {
  await upsertEntitlement(db, orgId, module, 'canceled', source);
}
