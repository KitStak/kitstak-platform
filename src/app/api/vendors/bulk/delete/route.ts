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
  handler: ({ db, auth, actor, body }) =>
    runBulk(db, body.ids, (tx, id) => {
      deleteVendor(tx, domainCtx(actor, auth), auth.scope, id);
    }),
});
