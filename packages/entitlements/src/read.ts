/**
 * Entitlement reads (BLUEPRINT.md §3.2 `src/read.ts`): `core.entitlements` per org with a
 * 60-second in-process TTL cache (same posture as CRM's in-memory rate limiting — one
 * cache per server process, never shared across instances), plus the gating rule:
 * `active|trialing` entitled, `past_due` entitled for GRACE_DAYS past the period end,
 * everything else blocked.
 */
import { eq } from 'drizzle-orm';
import { entitlements, type EntitlementSource, type EntitlementStatus } from '@kitstak/db/schema';
import type { EntitlementsDb } from './db';
import { isDevAllowAll } from './dev';
import type { Module } from './modules';

/** Days past `current_period_end` during which a `past_due` org keeps access. */
export const GRACE_DAYS = 7;

const CACHE_TTL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ModuleEntitlement {
  readonly status: EntitlementStatus;
  readonly source: EntitlementSource;
  readonly periodEnd: Date | null;
}

/** One entry per module; `null` means no `core.entitlements` row exists for it. */
export type EntitlementSnapshot = Readonly<Record<Module, ModuleEntitlement | null>>;

interface CacheEntry {
  readonly expiresAt: number;
  readonly snapshot: EntitlementSnapshot;
}

const cache = new Map<string, CacheEntry>();

/** Drops one org's cached snapshot, or the whole cache (tests, post-write invalidation). */
export function clearEntitlementsCache(orgId?: string): void {
  if (orgId === undefined) cache.clear();
  else cache.delete(orgId);
}

/**
 * The org's entitlement rows as a per-module snapshot, cached for 60 seconds per process.
 * Always queries the database (never short-circuited by the dev switch) so admin surfaces
 * can render the real state.
 */
export async function getEntitlements(db: EntitlementsDb, orgId: string): Promise<EntitlementSnapshot> {
  const cached = cache.get(orgId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.snapshot;

  const rows = await db
    .select({
      module: entitlements.module,
      status: entitlements.status,
      source: entitlements.source,
      periodEnd: entitlements.currentPeriodEnd,
    })
    .from(entitlements)
    .where(eq(entitlements.orgId, orgId));

  const draft: Record<Module, ModuleEntitlement | null> = { crm: null, wms: null, projects: null, pulse: null };
  for (const row of rows) {
    draft[row.module] = { status: row.status, source: row.source, periodEnd: row.periodEnd };
  }
  const snapshot: EntitlementSnapshot = Object.freeze(draft);
  cache.set(orgId, { expiresAt: now + CACHE_TTL_MS, snapshot });
  return snapshot;
}

/**
 * Pure gating rule for one module's entitlement:
 *  - `active` / `trialing` → entitled
 *  - `past_due`            → entitled while `now` ≤ `periodEnd` + GRACE_DAYS
 *                            (no period end recorded → fail closed)
 *  - `canceled` / no row   → blocked
 */
export function isEntitled(entitlement: ModuleEntitlement | null, now: Date = new Date()): boolean {
  if (!entitlement) return false;
  if (entitlement.status === 'active' || entitlement.status === 'trialing') return true;
  if (entitlement.status === 'past_due') {
    if (!entitlement.periodEnd) return false;
    return now.getTime() <= entitlement.periodEnd.getTime() + GRACE_DAYS * DAY_MS;
  }
  return false;
}

/**
 * Whether the org may use a module. `ENTITLEMENTS_DEV_ALLOW_ALL=1` short-circuits to
 * `true` without touching the database (see `./dev.ts` for the per-environment posture).
 */
export async function hasModule(db: EntitlementsDb, orgId: string, module: Module): Promise<boolean> {
  if (isDevAllowAll()) return true;
  const snapshot = await getEntitlements(db, orgId);
  return isEntitled(snapshot[module]);
}
