/** `GET /api/returns/lookup?warehouseId=&code=` — RMAs matching an RMA / order code / tracking number. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idSchema } from "@/server/repositories/platform-common";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { lookupRmas } from "@/server/repositories/returns-receive";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  query: z.object({ warehouseId: idSchema, code: z.string().trim().min(1, "Scan or enter a code").max(120) }),
  handler: ({ db, auth, query }) => lookupRmas(db, auth.scope, query.warehouseId, query.code),
});
