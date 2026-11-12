/** `POST /api/products/bulk/delete` { ids } — per-id result; guarded products fail with a reason. M09. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { runBulk } from "@/server/domain/bulk";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { deleteProduct } from "@/server/repositories/products-commands";

export const POST = defineRoute({
  permission: "settings.products.delete",
  body: z.object({ ids: bulkIdsSchema }),
  handler: async ({ db, auth, actor, body }) => {
    const ctx = { ...domainCtx(actor, auth), scope: auth.scope };
    return await runBulk(db, body.ids, async (tx, id) => await deleteProduct(tx, ctx, id));
  },
});
