/** `POST /api/products/bulk/status` { ids, status } — bulk activate / deactivate. M09. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { runBulk } from "@/server/domain/bulk";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { setProductStatus } from "@/server/repositories/products-commands";

export const POST = defineRoute({
  permission: "settings.products.edit",
  body: z.object({ ids: bulkIdsSchema, status: z.enum(["Active", "Inactive"]) }),
  handler: ({ db, auth, actor, body }) => {
    const ctx = { ...domainCtx(actor, auth), scope: auth.scope };
    return runBulk(db, body.ids, (tx, id) => {
      setProductStatus(tx, ctx, id, body.status);
    });
  },
});
