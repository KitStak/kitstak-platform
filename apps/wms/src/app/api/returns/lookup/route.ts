/**
 * `GET /api/returns/lookup?warehouseId=&code=` — RMAs matching an RMA / order code / tracking number.
 * `GET /api/returns/lookup?code=&anyWarehouse=1` — the other warehouses (in scope) where the code matches,
 * so the station can offer "Switch to <warehouse>" instead of a dead end.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { validationError } from "@/server/api/errors";
import { idSchema } from "@/server/repositories/platform-common";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { lookupRmas, rmaWarehousesFor } from "@/server/repositories/returns-receive";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  query: z.object({ warehouseId: idSchema.optional(), code: z.string().trim().min(1, "Scan or enter a code").max(120), anyWarehouse: z.enum(["1"]).optional() }),
  handler: async ({ db, auth, query }) => {
    if (query.anyWarehouse) return await rmaWarehousesFor(db, auth.scope, query.code);
    if (!query.warehouseId) throw validationError("Choose a warehouse", { warehouseId: ["Choose a warehouse"] });
    return await lookupRmas(db, auth.scope, query.warehouseId, query.code);
  },
});
