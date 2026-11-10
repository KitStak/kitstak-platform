/** `GET /api/counts/job-types?warehouseId=` - active Count job types (Create Job). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { notFoundError } from "@/server/api/errors";
import { hasWarehouse } from "@/server/auth/scope";
import { COUNT_ANY_VIEW } from "@/lib/grid-defs/counts/count-grids";
import { countJobTypes } from "@/server/repositories/counts-jobs";

export const GET = defineRoute({
  permission: COUNT_ANY_VIEW,
  query: z.object({ warehouseId: z.string().min(1).max(64) }),
  handler: ({ db, auth, query }) => {
    if (!hasWarehouse(auth.scope, query.warehouseId)) throw notFoundError("Warehouse");
    return countJobTypes(db, query.warehouseId);
  },
});
