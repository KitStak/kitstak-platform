/**
 * `POST /api/reports/inventory-snapshot/backfill` `{ warehouseIds? }` — rebuilds every missing
 * nightly inventory snapshot (last 31 business days) from the inventory ledger, stamped at
 * 00:02 warehouse time of each missed night (M13 round 6). Only fills nights with no run;
 * never edits or removes an existing snapshot. Needs the snapshot report AND warehouse edit
 * permission (it writes billing-relevant history); limited to warehouses in the caller's scope.
 * Each run is written to the audit log.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { result } from "@/server/api/envelope";
import { AppError } from "@/server/api/errors";
import { can } from "@/server/auth/permissions";
import { writeAudit } from "@/server/auth/audit";
import { SNAPSHOT_BACKFILL_PERMISSION, SNAPSHOT_DEF } from "@/lib/grid-defs/reports/inventory";
import { backfillMissingSnapshots } from "@/server/repositories/reports-snapshot-backfill";

const bodySchema = z.object({ warehouseIds: z.array(z.string().min(1).max(64)).max(200).optional() }).strict();

export const POST = defineRoute({
  name: "POST /api/reports/inventory-snapshot/backfill",
  permission: SNAPSHOT_BACKFILL_PERMISSION,
  body: bodySchema,
  handler: async ({ db, auth, body }) => {
    if (!can(auth, SNAPSHOT_DEF.permission as Parameters<typeof can>[1])) {
      throw new AppError("FORBIDDEN", "You need the Inventory Snapshot Report permission to rebuild snapshots.");
    }
    const requested = body.warehouseIds ?? auth.scope.warehouseIds;
    const warehouseIds = requested.filter((id) => auth.scope.warehouseIds.includes(id));
    if (warehouseIds.length === 0) throw new AppError("VALIDATION", "Pick at least one warehouse you have access to.", { fieldErrors: { warehouseIds: ["No warehouse in your scope"] } });
    const rebuilt = await backfillMissingSnapshots(db, { warehouseIds });
    const nights = rebuilt.reduce((n, w) => n + w.days.length, 0);
    await writeAudit(db, {
      action: "reports.inventory_snapshot.backfill", entity: "inventory_snapshots", entityId: warehouseIds.join(","), userId: auth.user.id,
      detail: { nights, warehouses: rebuilt.map((w) => ({ warehouse: w.warehouse, days: w.days.map((d) => d.businessDate), rows: w.days.reduce((n, d) => n + d.rows, 0) })) },
    });
    return result({ nights, warehouses: rebuilt });
  },
});
