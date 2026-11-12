/**
 * `POST /api/returns/status` `{ ids | lineIds, status, note?, version? }` — bulk Change Status.
 * Grid rows are RMA lines, so `lineIds` resolve to their RMAs. Per-id result (0.2).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { validationError } from "@/server/api/errors";
import { idSchema } from "@/server/repositories/platform-common";
import { changeReturnStatus, changeStatusSchema, RETURN_PERMISSIONS, returnIdsForLines, scopedCtx } from "@/server/repositories/returns";

const bodySchema = changeStatusSchema.partial({ ids: true }).extend({ lineIds: z.array(idSchema).max(1000).optional() });

export const POST = defineRoute({
  permission: RETURN_PERMISSIONS.changeStatus,
  body: bodySchema,
  handler: async ({ db, auth, actor, body }) => {
    const ids = body.ids ?? await returnIdsForLines(db, auth.scope, body.lineIds ?? []);
    if (ids.length === 0) throw validationError("Select at least one return");
    return await changeReturnStatus(db, scopedCtx(actor, auth), { ...body, ids });
  },
});
