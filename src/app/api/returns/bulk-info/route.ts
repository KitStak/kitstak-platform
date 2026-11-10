/**
 * `POST /api/returns/bulk-info` `{ ids | lineIds, expectedReturnDate?, carrierCode?, carrierServiceName?, trackingNumber?, fromCountry?, note? }`
 * — Logiwa "Bulk Update Return Info". Open RMAs only; per-id result (0.2), change_log per RMA.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { validationError } from "@/server/api/errors";
import { idSchema } from "@/server/repositories/platform-common";
import { bulkReturnInfoSchema, bulkUpdateReturnInfo, RETURN_PERMISSIONS, returnIdsForLines, scopedCtx } from "@/server/repositories/returns";

const bodySchema = z.object({ ids: z.array(idSchema).max(1000).optional(), lineIds: z.array(idSchema).max(1000).optional() }).passthrough();

export const POST = defineRoute({
  permission: RETURN_PERMISSIONS.changeStatus,
  body: bodySchema,
  handler: ({ db, auth, actor, body }) => {
    const ids = body.ids ?? returnIdsForLines(db, auth.scope, body.lineIds ?? []);
    if (ids.length === 0) throw validationError("Select at least one return");
    const parsed = bulkReturnInfoSchema.safeParse({ ...body, ids });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw validationError(issue?.message ?? "Invalid input", { [String(issue?.path[0] ?? "form")]: [issue?.message ?? "Invalid"] });
    }
    return bulkUpdateReturnInfo(db, scopedCtx(actor, auth), parsed.data);
  },
});
