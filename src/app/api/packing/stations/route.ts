/** `GET /api/packing/stations?warehouseId=` — Packing-area locations of a warehouse; `?stationId=` — that one station. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { validationError } from "@/server/api/errors";
import { idSchema } from "@/server/repositories/platform-common";
import { loadStation, PACKING_PERMISSIONS, packingStations } from "@/server/repositories/packing-scan";

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: z.object({ warehouseId: idSchema.optional(), stationId: idSchema.optional() }),
  handler: ({ db, auth, query }) => {
    if (query.stationId) return [loadStation(db, auth.scope, query.stationId)];
    if (!query.warehouseId) throw validationError("Choose a warehouse");
    return packingStations(db, auth.scope, query.warehouseId);
  },
});
