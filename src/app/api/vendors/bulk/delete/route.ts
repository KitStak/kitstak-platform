/** `POST /api/vendors/bulk/delete { ids }` — delete vendors never used on a purchase order. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { RATE_LIMITS } from "@/server/auth/rate-limit";
import { runBulk } from "@/server/domain";
import { domainCtx } from "@/server/repositories/platform-common";
import { deleteVendor } from "@/server/repositories/vendors";

export const POST = defineRoute({
  permission: "settings.vendors.delete",
  rateLimit: RATE_LIMITS.bulkIo,
  body: bulkIdsBodySchema,
  handler: async ({ db, auth, actor, body }) =>
    await runBulk(db, body.ids, async (tx, id) => {
      await deleteVendor(tx, domainCtx(actor, auth), auth.scope, id);
    }),
});
