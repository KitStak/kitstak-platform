/**
 * `GET /api/kits/recalculate`: when `kit_inventory_stats` was last recalculated.
 * `POST /api/kits/recalculate`: Recalculate Now. It rewrites a shared derived table, so it needs
 * the Work Orders create permission (the role that acts on the report), not just report view.
 * Repeated clicks within RECALC_COOLDOWN_MS return the fresh stamp instead of recomputing.
 */
import { defineRoute } from "@/server/api/define-route";
import { KIT_RECALC_EVERY_MS } from "@/lib/grid-defs/work-orders/kits";
import { lastKitRecalcAt, recalcKitInventory } from "@/server/repositories/kits";
import { KIT_PERMISSIONS, WO_PERMISSIONS } from "@/server/repositories/work-orders-api";

const RECALC_COOLDOWN_MS = 3_000;

export const GET = defineRoute({
  permission: KIT_PERMISSIONS.inventory,
  // The first read on a fresh install computes the snapshot, so the stamp never reads "never".
  transaction: false,
  handler: async ({ db }) => ({ updatedAt: await lastKitRecalcAt(db) ?? (await recalcKitInventory(db)).updatedAt, everyMs: KIT_RECALC_EVERY_MS }),
});

export const POST = defineRoute({
  permission: WO_PERMISSIONS.create,
  // recalcKitInventory opens its own transaction.
  transaction: false,
  handler: async ({ db, audit }) => {
    const last = await lastKitRecalcAt(db);
    if (last && Date.now() - Date.parse(last) < RECALC_COOLDOWN_MS) {
      return { rows: null, updatedAt: last, throttled: true };
    }
    const res = await recalcKitInventory(db);
    await audit({ action: "kit_inventory.recalculate", entity: "kit_inventory_stats", entityId: "all", detail: { rows: res.rows } });
    return { ...res, throttled: false };
  },
});
