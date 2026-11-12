/**
 * Pick-short preview for Task Details → Execute (critic R5, Logiwa-style pick-short handling).
 * Before a partial execute the drawer asks how much free stock the SKU has elsewhere (same
 * warehouse, client, lot / dates; active, unlocked, allocatable locations; excluding the source),
 * so "Create resolution job" can default ON when a re-pick is possible. The client settings that
 * stop a resolution (retain allocation during missing, prevent reallocation if missing) are
 * reported so the drawer explains why the toggle is off. The real reallocation still runs the
 * allocation algorithm in `domain/task-handlers/picking`; this is the estimate it is seeded from.
 */
import { sql } from 'drizzle-orm';
import { clientSettingsSchema, parseSettings } from '@/lib/domain-types';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import { assertInScope } from '@/server/auth/scope';
import { dbAll, dbGet } from '@/server/db/sql';

export interface PickShortPreview {
  readonly taskId: string;
  /** Picking task with an order line and allocation: a resolution job is possible in principle. */
  readonly eligible: boolean;
  readonly sourceLocation: string | null;
  readonly freeElsewhere: number;
  readonly locations: readonly { readonly code: string; readonly free: number }[];
  /** Client keeps the allocation while the missing report is investigated (no release, no re-pick). */
  readonly retainsAllocation: boolean;
  /** Client forbids reallocating missing stock. */
  readonly preventsReallocation: boolean;
  /** What "Create resolution job" should default to. */
  readonly suggestResolution: boolean;
}

interface TaskFacts {
  id: string;
  warehouseId: string;
  clientId: string | null;
  taskType: string;
  orderLineId: string | null;
  allocationId: string | null;
  orderClientId: string | null;
  productId: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  productionDate: string | null;
  sourceLocationId: string | null;
  sourceLocation: string | null;
  clientSettings: string | null;
}

/** PURE: the default for the Execute drawer's "Create resolution job" toggle. */
export function suggestResolution(p: {
  readonly eligible: boolean;
  readonly freeElsewhere: number;
  readonly retainsAllocation: boolean;
  readonly preventsReallocation: boolean;
}): boolean {
  return p.eligible && p.freeElsewhere > 0 && !p.retainsAllocation && !p.preventsReallocation;
}

/** Raw SQL returns the JSON column as text; a malformed value falls back to the defaults. */
function readClientSettings(
  raw: string | null,
): ReturnType<typeof parseSettings<typeof clientSettingsSchema>>['fulfillment'] {
  try {
    return parseSettings(clientSettingsSchema, raw ? JSON.parse(raw) : {}).fulfillment;
  } catch {
    return parseSettings(clientSettingsSchema, {}).fulfillment;
  }
}

export async function pickShortPreview(
  db: AppDb,
  auth: AuthContext,
  taskId: string,
): Promise<PickShortPreview> {
  const task = await dbGet<TaskFacts>(
    db,
    sql`SELECT t.id, t.warehouse_id AS "warehouseId", t.client_id AS "clientId", t.task_type AS "taskType",
      t.order_line_id AS "orderLineId", t.allocation_id AS "allocationId", o.client_id AS "orderClientId", l.product_id AS "productId",
      l.lot_number AS "lotNumber", l.expiry_date AS "expiryDate", l.production_date AS "productionDate",
      COALESCE(i.location_id, t.source_location_id) AS "sourceLocationId",
      (SELECT code FROM locations x WHERE x.id = COALESCE(i.location_id, t.source_location_id)) AS "sourceLocation",
      (SELECT c.settings FROM clients c WHERE c.id = o.client_id) AS "clientSettings"
    FROM tasks t
    LEFT JOIN order_lines l ON l.id = t.order_line_id
    LEFT JOIN shipment_orders o ON o.id = t.order_id
    LEFT JOIN inventory_allocations a ON a.id = t.allocation_id
    LEFT JOIN inventory i ON i.id = a.inventory_id
    WHERE t.id = ${taskId}`,
  );
  assertInScope(auth.scope, task, 'Task');
  const t = task as TaskFacts;
  const settings = readClientSettings(t.clientSettings);
  const retainsAllocation = Boolean(settings.retainAllocationDuringMissing);
  const preventsReallocation = Boolean(
    (settings as { preventReallocationIfMissing?: boolean }).preventReallocationIfMissing,
  );
  const eligible = t.taskType === 'Picking' && Boolean(t.orderLineId && t.allocationId && t.productId);
  let locations: { code: string; free: number }[] = [];
  if (eligible) {
    locations = (
      await dbAll<{ code: string; free: number }>(
        db,
        sql`SELECT loc.code AS code, SUM(i.on_hand - i.allocated) AS free
      FROM inventory i JOIN locations loc ON loc.id = i.location_id
      WHERE i.warehouse_id = ${t.warehouseId} AND i.client_id IS NOT DISTINCT FROM ${t.orderClientId} AND i.product_id = ${t.productId} AND i.status = 'Stock'
        AND i.damage_reason IS NULL AND i.on_hand - i.allocated > 0
        AND loc.is_active = true AND loc.is_locked = false AND loc.prevent_allocation = false
        AND (${t.sourceLocationId}::text IS NULL OR i.location_id <> ${t.sourceLocationId})
        AND (${t.lotNumber}::text IS NULL OR i.lot_number = ${t.lotNumber})
        AND (${t.expiryDate}::text IS NULL OR i.expiry_date = ${t.expiryDate})
        AND (${t.productionDate}::text IS NULL OR i.production_date = ${t.productionDate})
      GROUP BY loc.code ORDER BY free DESC, loc.code LIMIT 6`,
      )
    ).map((r) => ({ code: r.code, free: Number(r.free) }));
  }
  const freeElsewhere = locations.reduce((s, r) => s + r.free, 0);
  const base = { eligible, freeElsewhere, retainsAllocation, preventsReallocation };
  return {
    taskId,
    sourceLocation: t.sourceLocation,
    locations,
    ...base,
    suggestResolution: suggestResolution(base),
  };
}
