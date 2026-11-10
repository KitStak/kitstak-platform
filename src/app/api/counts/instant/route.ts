/** `POST /api/counts/instant` - Quick Count: creates an Instant Count plan (IC + timestamp) for one location and executes it. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { canAny } from "@/server/auth/permissions";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { canSelfApprove } from "@/server/repositories/counts-ops";
import { createInstantCount, instantCountSchema } from "@/server/repositories/counts-sheet";
import { domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: [P.create, P.mobileInstant],
  body: instantCountSchema,
  handler: ({ db, auth, actor, body }) =>
    created(createInstantCount(db, domainCtx(actor, auth), auth, body, canAny(auth, [P.updateInv, P.mobileInstantUpdate]), canSelfApprove(auth))),
});
