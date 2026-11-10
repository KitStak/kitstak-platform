/** `GET /api/returns/stations?warehouseId=` — Returns-area locations (Return Station picker). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idSchema } from "@/server/repositories/platform-common";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { returnStations } from "@/server/repositories/returns-receive";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  query: z.object({ warehouseId: idSchema }),
  handler: ({ db, auth, query }) => returnStations(db, auth.scope, query.warehouseId),
});
