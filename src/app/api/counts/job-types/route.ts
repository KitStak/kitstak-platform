/** `GET /api/counts/job-types?warehouseId=` - active Count job types (Create Job). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { notFoundError } from "@/server/api/errors";
import { hasWarehouse } from "@/server/auth/scope";
import { COUNT_ANY_VIEW } from "@/lib/grid-defs/counts/count-grids";
import { countJobTypes, ensureDefaultCountJobType } from "@/server/repositories/counts-jobs";
import { domainCtx } from "@/server/repositories/platform-common";

export const GET = defineRoute({
  permission: COUNT_ANY_VIEW,
  query: z.object({ warehouseId: z.string().min(1).max(64) }),
  handler: async ({ db, auth, query }) => {
    if (!hasWarehouse(auth.scope, query.warehouseId)) throw notFoundError("Warehouse");
    return await countJobTypes(db, query.warehouseId);
  },
});

/** `POST /api/counts/job-types { warehouseId }` - create the default Count job type when none exists (Create Job empty state). */
export const POST = defineRoute({
  permission: "settings.job_types.create",
  body: z.object({ warehouseId: z.string().min(1).max(64) }),
  handler: async ({ db, auth, actor, body }) => await ensureDefaultCountJobType(db, domainCtx(actor, auth), auth, body.warehouseId),
});
