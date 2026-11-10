/** `POST /api/products/bulk/delete-check` { ids } — which products can be deleted, and why not. Read-only. M09. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { deleteCheck } from "@/server/repositories/products-commands";

export const POST = defineRoute({
  permission: "settings.products.delete",
  body: z.object({ ids: bulkIdsSchema }),
  transaction: false,
  handler: ({ db, auth, actor, body }) => deleteCheck(db, { ...domainCtx(actor, auth), scope: auth.scope }, body.ids),
});
