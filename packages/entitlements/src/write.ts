/**
 * The full-row entitlement writer (docs/billing/CONTRACTS.md section 8). Trials and the billing sync
 * in `@kitstak/billing` write `core.entitlements` through this one function, so the rule "a live
 * manual grant is never touched" holds in one place, inside one SQL statement.
 */
import { sql } from 'drizzle-orm';
import { entitlements, type EntitlementSource, type EntitlementStatus } from '@kitstak/db/schema';
import type { EntitlementsDb } from './db';
import type { Module } from './modules';
import { clearEntitlementsCache } from './read';

export interface EntitlementWrite {
  readonly orgId: string;
  readonly module: Module;
  readonly status: EntitlementStatus;
  readonly source: EntitlementSource;
  readonly periodEnd: Date | null;
  readonly seats: number | null;
  readonly stripeSubscriptionId: string | null;
  readonly stripePriceId: string | null;
}

/**
 * Upsert on (org_id, module) that writes every column. Returns false and writes nothing when the
 * existing row is a live manual grant (source 'manual' and status 'active') and the write is not
 * itself 'manual'. Clears this process's cache for the org.
 *
 * The guard is part of the upsert itself (`ON CONFLICT ... DO UPDATE ... WHERE`), so two writers
 * racing on one row can never stomp a manual grant.
 */
export async function setEntitlement(db: EntitlementsDb, write: EntitlementWrite): Promise<boolean> {
  const now = new Date();
  const values = {
    orgId: write.orgId,
    module: write.module,
    status: write.status,
    source: write.source,
    currentPeriodEnd: write.periodEnd,
    seats: write.seats,
    stripeSubscriptionId: write.stripeSubscriptionId,
    stripePriceId: write.stripePriceId,
  };
  const written = await db
    .insert(entitlements)
    .values(values)
    .onConflictDoUpdate({
      target: [entitlements.orgId, entitlements.module],
      set: { ...values, updatedAt: now },
      setWhere:
        write.source === 'manual'
          ? undefined
          : sql`NOT (${entitlements.source} = 'manual' AND ${entitlements.status} = 'active')`,
    })
    .returning({ id: entitlements.id });
  clearEntitlementsCache(write.orgId);
  return written.length > 0;
}
