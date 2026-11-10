/** `GET /api/packing/hospitals?warehouseId=` — Report Issue destinations (default hospital first). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idSchema } from "@/server/repositories/platform-common";
import { hospitalOptions } from "@/server/repositories/packing";
import { PACKING_PERMISSIONS } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.reportIssue,
  query: z.object({ warehouseId: idSchema }),
  handler: ({ db, auth, query }) => hospitalOptions(db, auth.scope, query.warehouseId),
});
