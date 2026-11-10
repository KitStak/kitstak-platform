/**
 * `GET /api/kits/recalculate`: when `kit_inventory_stats` was last recalculated.
 * `POST /api/kits/recalculate`: Recalculate Now.
 */
import { defineRoute } from "@/server/api/define-route";
import { KIT_RECALC_EVERY_MS } from "@/lib/grid-defs/work-orders/kits";
import { lastKitRecalcAt, recalcKitInventory } from "@/server/repositories/kits";
import { KIT_PERMISSIONS } from "@/server/repositories/work-orders-api";

export const GET = defineRoute({
  permission: KIT_PERMISSIONS.inventory,
  handler: ({ db }) => ({ updatedAt: lastKitRecalcAt(db), everyMs: KIT_RECALC_EVERY_MS }),
});

export const POST = defineRoute({
  permission: KIT_PERMISSIONS.inventory,
  // recalcKitInventory opens its own transaction.
  transaction: false,
  handler: ({ db, audit }) => {
    const res = recalcKitInventory(db);
    audit({ action: "kit_inventory.recalculate", entity: "kit_inventory_stats", entityId: "all", detail: { rows: res.rows } });
    return res;
  },
});
