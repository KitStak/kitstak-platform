/**
 * `GET /api/packing/orders/[id]?stationId=` — pack context: lines to pack, scan codes, packages, carriers, client settings,
 * and the count-plan lock (station or staged stock) that would stop Complete.
 * `POST /api/packing/orders/[id]?stationId=` — start packing (Ready to Pack → Packing Started), then the pack context.
 * A count-locked order is not started: the context comes back with `countLock` so the screen blocks before any scan.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema, idSchema } from "@/server/repositories/platform-common";
import { packContext, startPacking } from "@/server/repositories/packing";
import { PACKING_PERMISSIONS } from "@/server/repositories/packing-scan";
import { scopedCtx } from "@/server/repositories/returns";

const query = z.object({ stationId: idSchema.optional() });

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  params: idParamsSchema,
  query,
  handler: ({ db, auth, params, query: q }) => packContext(db, auth.scope, params.id, q.stationId ?? null),
});

export const POST = defineRoute({
  permission: PACKING_PERMISSIONS.execute,
  params: idParamsSchema,
  query,
  handler: ({ db, auth, actor, params, query: q }) => {
    const ctx = packContext(db, auth.scope, params.id, q.stationId ?? null);
    if (ctx.countLock) return ctx;
    startPacking(db, scopedCtx(actor, auth), params.id);
    return packContext(db, auth.scope, params.id, q.stationId ?? null);
  },
});
