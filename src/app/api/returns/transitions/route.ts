/** `GET /api/returns/transitions?ids=a,b | lineIds=a,b` — legal target statuses for a selection. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { validationError } from "@/server/api/errors";
import { RETURN_PERMISSIONS, returnIdsForLines, selectionTransitions } from "@/server/repositories/returns";

const csv = z.string().max(40000).optional().transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []));

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.view,
  query: z.object({ ids: csv, lineIds: csv }),
  handler: async ({ db, auth, query }) => {
    const ids = query.ids.length ? query.ids : await returnIdsForLines(db, auth.scope, query.lineIds);
    if (ids.length === 0) throw validationError("Select at least one return");
    return await selectionTransitions(db, auth.scope, ids.slice(0, 1000), query.ids.length ? [] : query.lineIds);
  },
});
