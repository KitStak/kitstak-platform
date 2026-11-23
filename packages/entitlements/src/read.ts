/**
 * Entitlement reads (BLUEPRINT.md §3.2 `src/read.ts`, docs/billing/CONTRACTS.md section 8):
 * `core.entitlements` per org with a 60-second in-process TTL cache (one cache per server process,
 * never shared across instances), plus the one access rule, `moduleAccess`.
 *
 * Three levels of access: `full`, `read_only` (view only: a trial past its end, a late payment past
 * the grace days, a pause, an ended plan) and `locked` (never in the plan, or revoked by hand).
 * A cached answer that is not `full` is always read again, so good news (a payment, a new trial)
 * shows in every app on the next request, while bad news may take up to 60 seconds.
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

export type ModuleAccess = 'full' | 'read_only' | 'locked';

export interface ModuleEntitlement {
  readonly status: EntitlementStatus;
  readonly source: EntitlementSource;
  readonly periodEnd: Date | null;
  /** Seats the row was written with (null when the app is not priced per seat). */
  readonly seats: number | null;
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

async function readSnapshot(db: EntitlementsDb, orgId: string): Promise<EntitlementSnapshot> {
  const rows = await db
    .select({
      module: entitlements.module,
      status: entitlements.status,
      source: entitlements.source,
      periodEnd: entitlements.currentPeriodEnd,
      seats: entitlements.seats,
    })
    .from(entitlements)
    .where(eq(entitlements.orgId, orgId));

  const draft: Record<Module, ModuleEntitlement | null> = { crm: null, wms: null, projects: null, pulse: null };
  for (const row of rows) {
    draft[row.module] = {
      status: row.status,
      source: row.source,
      periodEnd: row.periodEnd,
      seats: row.seats ?? null,
    };
  }
  const snapshot: EntitlementSnapshot = Object.freeze(draft);
  cache.set(orgId, { expiresAt: Date.now() + CACHE_TTL_MS, snapshot });
  return snapshot;
}

/** The snapshot plus whether it came from the cache (so a "not full" answer can be read again). */
async function loadSnapshot(
  db: EntitlementsDb,
  orgId: string,
): Promise<{ snapshot: EntitlementSnapshot; fromCache: boolean }> {
  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return { snapshot: cached.snapshot, fromCache: true };
  return { snapshot: await readSnapshot(db, orgId), fromCache: false };
}

/**
 * The org's entitlement rows as a per-module snapshot, cached for 60 seconds per process.
 * Always queries the database (never short-circuited by the dev switch) so admin surfaces
 * can render the real state.
 */
export async function getEntitlements(db: EntitlementsDb, orgId: string): Promise<EntitlementSnapshot> {
  return (await loadSnapshot(db, orgId)).snapshot;
}

/** The org's entitlement rows read straight from the database. Refreshes the cache. */
export async function getEntitlementsFresh(db: EntitlementsDb, orgId: string): Promise<EntitlementSnapshot> {
  return readSnapshot(db, orgId);
}

/**
 * The one access rule. Pure.
 *
 *  - no row                                   -> locked
 *  - `active`                                 -> full
 *  - `trialing`, no period end (old rows)     -> full
 *  - `trialing`, period end in the future     -> full
 *  - `trialing`, period end in the past       -> read_only
 *  - `past_due`, no period end                -> locked (fail closed)
 *  - `past_due`, within period end + GRACE    -> full
 *  - `past_due`, later                        -> read_only
 *  - `canceled`, source `manual`              -> locked (a manual revoke stays a lock)
 *  - `canceled`, period end in the future     -> full (paid time is never taken away)
 *  - `canceled`, otherwise                    -> read_only
 */
export function moduleAccess(entitlement: ModuleEntitlement | null, now: Date = new Date()): ModuleAccess {
  if (!entitlement) return 'locked';
  const end = entitlement.periodEnd ? entitlement.periodEnd.getTime() : null;
  const at = now.getTime();
  switch (entitlement.status) {
    case 'active':
      return 'full';
    case 'trialing':
      return end === null || at < end ? 'full' : 'read_only';
    case 'past_due':
      if (end === null) return 'locked';
      return at <= end + GRACE_DAYS * DAY_MS ? 'full' : 'read_only';
    case 'canceled':
      if (entitlement.source === 'manual') return 'locked';
      return end !== null && at < end ? 'full' : 'read_only';
    default:
      return 'locked';
  }
}

/** True only for full access. A trial past its end is not entitled. */
export function isEntitled(entitlement: ModuleEntitlement | null, now: Date = new Date()): boolean {
  return moduleAccess(entitlement, now) === 'full';
}

/**
 * The org's access to one module. `ENTITLEMENTS_DEV_ALLOW_ALL=1` short-circuits to `full` without
 * touching the database. A cached answer that is not `full` is read again before it is returned.
 */
export async function getModuleAccess(db: EntitlementsDb, orgId: string, module: Module): Promise<ModuleAccess> {
  if (isDevAllowAll()) return 'full';
  const { snapshot, fromCache } = await loadSnapshot(db, orgId);
  const access = moduleAccess(snapshot[module]);
  if (access === 'full' || !fromCache) return access;
  return moduleAccess((await readSnapshot(db, orgId))[module]);
}

/**
 * Whether the org may use a module with full access. `ENTITLEMENTS_DEV_ALLOW_ALL=1` short-circuits to
 * `true` without touching the database (see `./dev.ts` for the per-environment posture).
 */
export async function hasModule(db: EntitlementsDb, orgId: string, module: Module): Promise<boolean> {
  return (await getModuleAccess(db, orgId, module)) === 'full';
}
