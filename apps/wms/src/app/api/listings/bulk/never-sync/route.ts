/** `POST /api/listings/bulk/never-sync` { ids, neverSync } — per-id result. M09. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { runBulk } from "@/server/domain/bulk";
import { setNeverSync } from "@/server/repositories/listings";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: "settings.product_listing.search_a_product",
  body: z.object({ ids: bulkIdsSchema, neverSync: z.boolean() }),
  handler: async ({ db, auth, actor, body }) => {
    const ctx = { ...domainCtx(actor, auth), scope: auth.scope };
    return await runBulk(db, body.ids, async (tx, id) => {
      await setNeverSync(tx, ctx, id, body.neverSync);
    });
  },
});
