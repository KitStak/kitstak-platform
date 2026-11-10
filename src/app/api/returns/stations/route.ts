/** `GET /api/returns/stations?warehouseId=` — Returns-area locations (Return Station picker). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { warehouseIdParam } from "@/server/repositories/packing-scan";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { returnStations } from "@/server/repositories/returns-receive";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  query: z.object({ warehouseId: warehouseIdParam }),
  handler: ({ db, auth, query }) => returnStations(db, auth.scope, query.warehouseId),
});
