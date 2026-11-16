/**
 * "Get set up" guide — server side (cross-app onboarding, WMS half).
 *
 * Reads: live existence checks on wms masters (one round trip) + the org-level
 * `core.onboarding_progress` rows for scope 'wms' (user_id IS NULL). WMS is
 * the org owning the request's warehouse (`warehouseOrgId`). A failed
 * probe degrades: `loadSetupGuide` returns null and the panel renders nothing —
 * the guide never takes the dashboard down with it.
 * Writes: per-step skip/unskip and guide dismiss/restore, upserted against the
 * partial unique index WHERE user_id IS NULL; plus the rollout "seen" marker
 * (guide row, status 'completed'), written via `after()` so no DB work is ever
 * left in flight past the response (serverless pool rule). Everything the system
 * can observe (warehouses, orders, …) is derived in `@/lib/setup-guide-model`.
 */
import { after } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { onboardingProgress } from '@kitstak/db/schema';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import { warehouseOrgId } from '@/server/auth/credentials';
import { dbGet, withWriteTx } from '@/server/db/sql';
import { clients, locations, products, shipmentOrders, warehouses } from '@/server/db/schema';
import {
  deriveSetupGuide,
  SETUP_GUIDE_KEY,
  SETUP_STEP_KEYS,
  type SetupGuide,
  type SetupGuideInput,
  type SetupStepKey,
} from '@/lib/setup-guide-model';

export type SetupGuideAction = 'skip' | 'unskip' | 'dismiss' | 'restore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `completed_by` is a uuid column; non-uuid (fixture) user ids degrade to NULL. */
function auditId(userId: string | null | undefined): string | null {
  return userId && UUID_RE.test(userId) ? userId : null;
}

/** EXISTS per master table, one round trip; the model only needs "> 0". */
async function loadCounts(db: AppDb): Promise<SetupGuideInput['counts']> {
  const row = await dbGet<Record<SetupStepKey, boolean | number | null>>(
    db,
    sql`select
      exists(select 1 from ${warehouses}) as "wms_warehouse",
      exists(select 1 from ${locations}) as "wms_locations",
      exists(select 1 from ${clients}) as "wms_client",
      exists(select 1 from ${products}) as "wms_catalog",
      exists(select 1 from ${shipmentOrders}) as "wms_first_order"`,
  );
  const counts = {} as Record<SetupStepKey, number>;
  for (const key of SETUP_STEP_KEYS) counts[key] = row?.[key] ? 1 : 0;
  return counts;
}

async function loadProgressRows(db: AppDb, orgId: string): Promise<SetupGuideInput['rows']> {
  return await db
    .select({ stepKey: onboardingProgress.stepKey, status: onboardingProgress.status })
    .from(onboardingProgress)
    .where(
      and(
        eq(onboardingProgress.orgId, orgId),
        eq(onboardingProgress.scope, 'wms'),
        isNull(onboardingProgress.userId),
      ),
    );
}

async function deriveFresh(db: AppDb, orgId: string): Promise<SetupGuide> {
  const [counts, rows] = await Promise.all([loadCounts(db), loadProgressRows(db, orgId)]);
  return deriveSetupGuide({ counts, rows });
}

/**
 * Full derived guide state for the dashboard panel, or null when a probe fails
 * (the panel hides; the dashboard is unaffected — mirrors the portal's countOrNull).
 *
 * Rollout guard: the first time the guide renders in an incomplete state, schedule
 * an org-level 'guide' row with status 'completed' (the "seen" marker) via
 * `after()` — never inline in the GET/loader path. The marker is what lets a
 * finished install keep showing its celebration, while an install that was mature
 * before this shipped never sees the guide at all (`visible` in the model).
 */
export async function loadSetupGuide(db: AppDb): Promise<SetupGuide | null> {
  try {
    const orgId = await warehouseOrgId(db);
    const guide = await deriveFresh(db, orgId);
    if (guide.visible && !guide.allDone && !guide.seen) {
      // Own try: outside a request scope after() throws, which must not be mistaken
      // for a probe failure (the guide would hide with a misleading log).
      try {
        after(async () => {
          try {
            // onConflictDoNothing: never overwrite a 'dismissed' row written between
            // derive and this deferred callback.
            await withWriteTx(db, async (tx) => {
              await tx
                .insert(onboardingProgress)
                .values({
                  orgId,
                  userId: null,
                  scope: 'wms',
                  stepKey: SETUP_GUIDE_KEY,
                  status: 'completed',
                  completedBy: null,
                })
                .onConflictDoNothing();
            });
          } catch (error: unknown) {
            console.error('[wms] setup guide seen-marker write failed', error);
          }
        });
      } catch {
        // No request scope (tests, scripts): the next load records the marker instead.
      }
    }
    return guide;
  } catch (error: unknown) {
    console.error('[wms] setup guide probe failed; hiding the guide', error);
    return null;
  }
}

function isStepKey(value: string | undefined): value is SetupStepKey {
  return (SETUP_STEP_KEYS as readonly string[]).includes(value ?? '');
}

async function upsertOrgRow(
  db: AppDb,
  orgId: string,
  stepKey: string,
  status: 'skipped' | 'dismissed' | 'completed',
  userId: string | null,
): Promise<void> {
  const completedBy = auditId(userId);
  await db
    .insert(onboardingProgress)
    .values({ orgId, userId: null, scope: 'wms', stepKey, status, completedBy })
    .onConflictDoUpdate({
      target: [onboardingProgress.orgId, onboardingProgress.scope, onboardingProgress.stepKey],
      targetWhere: sql`user_id IS NULL`,
      set: { status, completedBy, updatedAt: new Date() },
    });
}

async function deleteOrgRow(db: AppDb, orgId: string, stepKey: string): Promise<void> {
  await db
    .delete(onboardingProgress)
    .where(
      and(
        eq(onboardingProgress.orgId, orgId),
        eq(onboardingProgress.scope, 'wms'),
        eq(onboardingProgress.stepKey, stepKey),
        isNull(onboardingProgress.userId),
      ),
    );
}

/**
 * Applies one explicit guide action and returns the fresh derived state.
 * skip/unskip need a valid step key; dismiss/restore target the 'guide' row.
 * Restore flips the row back to 'completed' (not a delete) so the rollout
 * "seen" marker survives a dismiss → restore round trip.
 */
export async function applySetupGuideAction(
  db: AppDb,
  action: SetupGuideAction,
  stepKey: string | undefined,
  userId: string | null,
): Promise<SetupGuide> {
  const orgId = await warehouseOrgId(db);
  if (action === 'skip' || action === 'unskip') {
    if (!isStepKey(stepKey)) throw new AppError('VALIDATION', 'Unknown setup step');
    if (action === 'skip') await upsertOrgRow(db, orgId, stepKey, 'skipped', userId);
    else await deleteOrgRow(db, orgId, stepKey);
  } else if (action === 'dismiss') {
    await upsertOrgRow(db, orgId, SETUP_GUIDE_KEY, 'dismissed', userId);
  } else {
    await upsertOrgRow(db, orgId, SETUP_GUIDE_KEY, 'completed', userId);
  }
  return await deriveFresh(db, orgId);
}
