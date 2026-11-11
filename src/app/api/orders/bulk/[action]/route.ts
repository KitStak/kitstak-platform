/**
 * `POST /api/orders/bulk/{cancel,hold,release,change-warehouse,delete,backorder,
 * resolve-pick-short,resolve-pack-short,unmerge,cancel-picking,update-return-info,remove-serials}`
 * `{ ids, ...extra }` -> `{ succeeded, failed }` (BUILD_PLAN 0.2). Each action maps to a
 * "Shipment Orders" permission key (`ORDER_BULK_PERMISSIONS`).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { forbiddenError, fromZodError, notFoundError } from "@/server/api/errors";
import { can } from "@/server/auth/permissions";
import { ORDER_BULK_ACTIONS, ORDER_BULK_PERMISSIONS, type OrderBulkAction } from "@/lib/grid-defs/orders/shipment-orders";
import { BULK_BODY_SCHEMAS, runOrderBulk } from "@/server/repositories/orders-bulk";
import { domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  params: z.object({ action: z.string().max(40) }),
  permission: Object.values(ORDER_BULK_PERMISSIONS),
  body: z.object({}).loose(),
  handler: async ({ db, auth, actor, params, body }) => {
    if (!(ORDER_BULK_ACTIONS as readonly string[]).includes(params.action)) throw notFoundError("Bulk action");
    const action = params.action as OrderBulkAction;
    if (!can(auth, ORDER_BULK_PERMISSIONS[action])) throw forbiddenError();
    const parsed = BULK_BODY_SCHEMAS[action].safeParse(body);
    if (!parsed.success) throw fromZodError(parsed.error);
    return await runOrderBulk(action, db, domainCtx(actor, auth), parsed.data as Record<string, unknown>);
  },
});
