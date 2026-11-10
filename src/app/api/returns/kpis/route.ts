/** `GET /api/returns/kpis?warehouseId=` — Return Station tiles (today, this user; open returns). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { warehouseIdParam } from "@/server/repositories/packing-scan";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { returnStationKpis } from "@/server/repositories/returns-receive";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  query: z.object({ warehouseId: warehouseIdParam }),
  handler: ({ db, auth, actor, query }) => returnStationKpis(db, auth.scope, query.warehouseId, actor.source),
});
