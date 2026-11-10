/**
 * `POST /api/inventory/buckets/[id]/quantity` `{ mode: add|adjust|remove, qty, reasonId?, note?, version? }`
 * Row actions Add / Adjust (absolute new quantity) / Remove on a Stock row (spec 04 §2.1–2.3).
 * Each mode has its own permission; the route accepts any of them and checks the mode's key.
 * Removing the last unit or adjusting to 0 posts the negative delta and deletes the emptied
 * record (Logiwa: "Setting the quantity to 0 will delete this inventory record"), so the
 * response carries `bucket: null` and `deleted: true`.
 */
import { defineRoute } from "@/server/api/define-route";
import { forbiddenError } from "@/server/api/errors";
import { can } from "@/server/auth/permissions";
import { changeQuantity, quantityChangeSchema } from "@/server/repositories/inventory-commands";
import { findBucketRow } from "@/server/repositories/inventory-by-location";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";

const BY_MODE = { add: P.addLine, adjust: P.adjustLine, remove: P.removeLine } as const;

export const POST = defineRoute({
  permission: [P.addLine, P.adjustLine, P.removeLine],
  params: idParamsSchema,
  body: quantityChangeSchema,
  handler: ({ db, auth, actor, params, body }) => {
    if (!can(auth, BY_MODE[body.mode])) throw forbiddenError();
    const result = changeQuantity(db, domainCtx(actor, auth), params.id, body);
    const bucket = result.to > 0 ? findBucketRow(db, auth, result.inventoryId) : null;
    return { ...result, deleted: result.to === 0, bucket };
  },
});
