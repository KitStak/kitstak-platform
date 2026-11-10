/** `POST /api/lp-types/bulk-delete { ids }` — per-id result; blocked while LP numbers exist. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/facility/common";
import { deleteLpTypes } from "@/server/repositories/lp-types";

export const POST = defineRoute({
  permission: "settings.lp_types.delete",
  body: bulkIds,
  handler: ({ db, auth, actor, body }) => deleteLpTypes(db, auth, actor, body.ids),
});
