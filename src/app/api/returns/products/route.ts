/** `GET /api/returns/products?clientId=&code=` — exact SKU / barcode match for a client (scan). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idSchema } from "@/server/repositories/platform-common";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { resolveProduct } from "@/server/repositories/returns-receive";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  query: z.object({ clientId: idSchema, code: z.string().trim().min(1).max(120) }),
  handler: ({ db, auth, query }) => resolveProduct(db, auth.scope, query.clientId, query.code),
});
