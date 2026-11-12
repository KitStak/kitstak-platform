/**
 * Open-count overlap guard (M07). A location, SKU or license plate may sit in only one open
 * count plan at a time, so two counts never post into the same stock and a Lock Locations
 * plan really holds its locations:
 *   - `openCountConflicts` finds the open plans that already cover the requested locations /
 *     products / LPs (used by create, edit, import and the wave command);
 *   - `assertNoOpenCountConflicts` rejects a plan write, naming each conflicting plan;
 *   - `foreignCountLock` / `assertPostAllowed` stop a plan's Update Inv. (and Quick Count)
 *     from posting into a location another Lock Locations plan holds.
 * The picker grids flag the same rows through `OPEN_COUNT_FOR_LOCATION` / `OPEN_COUNT_FOR_PRODUCT`.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import { DomainError } from '@/server/domain/errors';
import type { Tx } from '@/server/domain/types';
import { dbAll, dbGet } from '@/server/db/sql';

/** Plan statuses during which a plan is "open" (not finished). */
export const OPEN_PLAN_STATUSES_SQL = "('Pending', 'Ready To Count', 'Count Started', 'Count Completed')";
/** Line statuses that no longer cover their stock. */
export const RELEASED_LINE_STATUSES_SQL = "('Cancelled', 'Inventory Updated', 'Recount Created')";

const openLineOf = (
  match: SQL,
  exceptPlanId: string | null | undefined,
): SQL => sql`(SELECT cp.code FROM count_plan_lines cl JOIN count_plans cp ON cp.id = cl.plan_id
  WHERE ${match} AND cp.status IN ${sql.raw(OPEN_PLAN_STATUSES_SQL)} AND cl.status NOT IN ${sql.raw(RELEASED_LINE_STATUSES_SQL)}
  ${exceptPlanId ? sql`AND cp.id <> ${exceptPlanId}` : sql``} ORDER BY cp.created_at LIMIT 1)`;

/** Picker column: code of the open count plan holding the location (`lo` alias), else NULL. */
export const openCountForLocation = (exceptPlanId?: string | null): SQL =>
  openLineOf(sql.raw('cl.location_id = lo.id'), exceptPlanId);
/** Picker column: code of the open count plan holding the product (`pr` alias), else NULL. */
export const openCountForProduct = (exceptPlanId?: string | null): SQL =>
  openLineOf(sql.raw('cl.product_id = pr.id'), exceptPlanId);
/** Picker column: code of the open count plan holding the LP (`lp` alias) or its whole location, else NULL. */
export const openCountForLp = (exceptPlanId?: string | null): SQL =>
  openLineOf(
    sql.raw(
      '(cl.lp_id = lp.id OR (cl.lp_id IS NULL AND cl.product_id IS NULL AND cl.location_id = lp.location_id))',
    ),
    exceptPlanId,
  );

export interface CountConflict {
  readonly kind: 'location' | 'product' | 'lp';
  readonly id: string;
  /** Location code, SKU or LP number. */
  readonly label: string;
  readonly planId: string;
  readonly planCode: string;
}

export interface ConflictQuery {
  readonly warehouseId: string;
  readonly locationIds?: readonly string[];
  readonly productIds?: readonly string[];
  readonly lpIds?: readonly string[];
  /** The plan being edited (its own lines never conflict). */
  readonly exceptPlanId?: string | null;
}

const list = (ids: readonly string[]) =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );
const except = (id: string | null | undefined) => (id ? sql`AND cp.id <> ${id}` : sql``);

/** Open plans (other than `exceptPlanId`) in the warehouse that already cover the given locations, SKUs or LPs. */
export async function openCountConflicts(tx: Tx | AppDb, q: ConflictQuery): Promise<CountConflict[]> {
  const out: CountConflict[] = [];
  const open = sql.raw(OPEN_PLAN_STATUSES_SQL);
  const released = sql.raw(RELEASED_LINE_STATUSES_SQL);
  const locationIds = [...new Set(q.locationIds ?? [])];
  const productIds = [...new Set(q.productIds ?? [])];
  const lpIds = [...new Set(q.lpIds ?? [])];
  if (locationIds.length) {
    out.push(
      ...(
        await dbAll<Omit<CountConflict, 'kind'>>(
          tx,
          sql`
      SELECT lo.id AS id, lo.code AS label, (array_agg(cp.id ORDER BY cp.code))[1] AS "planId", MIN(cp.code) AS "planCode"
      FROM count_plan_lines cl JOIN count_plans cp ON cp.id = cl.plan_id JOIN locations lo ON lo.id = cl.location_id
      WHERE cl.location_id IN (${list(locationIds)}) AND cp.warehouse_id = ${q.warehouseId}
        AND cp.status IN ${open} AND cl.status NOT IN ${released} ${except(q.exceptPlanId)}
      GROUP BY lo.id ORDER BY lo.code`,
        )
      ).map((r) => ({ ...r, kind: 'location' as const })),
    );
  }
  if (productIds.length) {
    out.push(
      ...(
        await dbAll<Omit<CountConflict, 'kind'>>(
          tx,
          sql`
      SELECT pr.id AS id, pr.sku AS label, (array_agg(cp.id ORDER BY cp.code))[1] AS "planId", MIN(cp.code) AS "planCode"
      FROM count_plan_lines cl JOIN count_plans cp ON cp.id = cl.plan_id JOIN products pr ON pr.id = cl.product_id
      WHERE cl.product_id IN (${list(productIds)}) AND cp.warehouse_id = ${q.warehouseId}
        AND cp.status IN ${open} AND cl.status NOT IN ${released} ${except(q.exceptPlanId)}
      GROUP BY pr.id ORDER BY pr.sku`,
        )
      ).map((r) => ({ ...r, kind: 'product' as const })),
    );
  }
  if (lpIds.length) {
    // An LP conflicts with a count of the LP itself or of the whole location it sits in.
    out.push(
      ...(
        await dbAll<Omit<CountConflict, 'kind'>>(
          tx,
          sql`
      SELECT n.id AS id, n.number AS label, (array_agg(cp.id ORDER BY cp.code))[1] AS "planId", MIN(cp.code) AS "planCode"
      FROM license_plates n JOIN count_plan_lines cl ON (cl.lp_id = n.id OR (cl.lp_id IS NULL AND cl.product_id IS NULL AND cl.location_id = n.location_id))
      JOIN count_plans cp ON cp.id = cl.plan_id
      WHERE n.id IN (${list(lpIds)}) AND cp.warehouse_id = ${q.warehouseId}
        AND cp.status IN ${open} AND cl.status NOT IN ${released} ${except(q.exceptPlanId)}
      GROUP BY n.id ORDER BY n.number`,
        )
      ).map((r) => ({ ...r, kind: 'lp' as const })),
    );
  }
  return out;
}

/** "MLT1-B-01 (CNT000146), MLT1-B-02 (CNT000146) +3 more". */
export function describeConflicts(conflicts: readonly CountConflict[], max = 5): string {
  const head = conflicts
    .slice(0, max)
    .map((c) => `${c.label} (${c.planCode})`)
    .join(', ');
  return conflicts.length > max ? `${head} +${conflicts.length - max} more` : head;
}

const FIELD = { location: 'locationIds', product: 'productIds', lp: 'lpIds' } as const;
const NOUN = {
  location: ['location', 'locations'],
  product: ['SKU', 'SKUs'],
  lp: ['license plate', 'license plates'],
} as const;

/** Rejects a plan write when any location / SKU / LP is already in another open count plan. */
export async function assertNoOpenCountConflicts(tx: Tx | AppDb, q: ConflictQuery): Promise<void> {
  const conflicts = await openCountConflicts(tx, q);
  if (conflicts.length === 0) return;
  const kind = conflicts[0]!.kind;
  const [one, many] = NOUN[kind];
  const plans = [...new Set(conflicts.map((c) => c.planCode))];
  const message =
    `${conflicts.length === 1 ? `This ${one} is` : `${conflicts.length} ${many} are`} already in an open count plan: ${describeConflicts(conflicts)}. ` +
    `Remove ${conflicts.length === 1 ? 'it' : 'them'}, or finish or cancel ${plans.length === 1 ? plans[0] : 'those plans'} first.`;
  const fieldErrors: Record<string, string[]> = {};
  for (const c of conflicts)
    (fieldErrors[FIELD[c.kind]] ??= []).push(`${c.label} is in open count plan ${c.planCode}`);
  // VALIDATION (not CONFLICT): CONFLICT means "record changed since you opened it" to the clients.
  throw new AppError('VALIDATION', message, {
    fieldErrors,
    details: {
      conflicts: conflicts.map((c) => ({ kind: c.kind, id: c.id, label: c.label, planCode: c.planCode })),
    },
  });
}

/**
 * Another Lock Locations plan holds `locationId` against `plan`: the earliest open locking plan
 * covering the location wins, so of two overlapping legacy plans only the older one may post.
 * Returns that plan's code, or null when `plan` may post into the location.
 */
export async function foreignCountLock(
  tx: Tx | AppDb,
  plan: { readonly id: string; readonly lockLocations: boolean; readonly createdAt: string },
  locationId: string,
): Promise<string | null> {
  const row = await dbGet<{ code: string }>(
    tx,
    sql`
    SELECT cp.code AS code FROM count_plan_lines cl JOIN count_plans cp ON cp.id = cl.plan_id
    WHERE cp.id <> ${plan.id} AND cp.lock_locations = true
      AND cp.status IN ${sql.raw(OPEN_PLAN_STATUSES_SQL)} AND cl.status NOT IN ${sql.raw(RELEASED_LINE_STATUSES_SQL)}
      AND (cl.location_id = ${locationId}
        OR (cl.location_id IS NULL AND cl.product_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM inventory ci WHERE ci.location_id = ${locationId} AND ci.product_id = cl.product_id AND ci.warehouse_id = cp.warehouse_id AND ci.on_hand > 0)))
      AND (${plan.lockLocations ? 0 : 1} = 1 OR cp.created_at < ${plan.createdAt} OR (cp.created_at = ${plan.createdAt} AND cp.id < ${plan.id}))
    ORDER BY cp.created_at LIMIT 1`,
  );
  return row?.code ?? null;
}

export function foreignLockMessage(locationCode: string, holderCode: string): string {
  return `${locationCode} is locked by count plan ${holderCode}. Finish, update or cancel ${holderCode} before posting another count into this location.`;
}

/** Throws when another Lock Locations plan holds any of the locations this plan wants to post into. */
export async function assertPostAllowed(
  tx: Tx | AppDb,
  plan: { readonly id: string; readonly lockLocations: boolean; readonly createdAt: string },
  locations: readonly { readonly id: string; readonly code: string }[],
): Promise<void> {
  for (const loc of locations) {
    const holder = await foreignCountLock(tx, plan, loc.id);
    if (holder)
      throw new DomainError('RULE_VIOLATION', foreignLockMessage(loc.code, holder), {
        countPlanCode: holder,
      });
  }
}
