/** `POST /api/printouts/bulk-delete` `{ ids }` — deletes templates; default templates fail with a reason. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema } from "@/lib/grid-defs/admin/common";
import { deletePrintouts } from "@/server/repositories/printouts";

export const POST = defineRoute({
  permission: "settings.printouts_labels.delete",
  body: bulkIdsSchema,
  handler: ({ db, auth, actor, body }) => deletePrintouts(db, auth, actor, body.ids),
});
