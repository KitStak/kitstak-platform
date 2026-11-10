/** `GET /api/locations/zones?warehouseId=` — zone summary strip (bins, occupied, units). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { getZoneSummary } from "@/server/repositories/locations";

export const GET = defineRoute({
  permission: "settings.locations.view",
  query: z.object({ warehouseId: z.string().trim().max(64).optional() }),
  handler: ({ db, auth, query }) => getZoneSummary(db, auth, query.warehouseId),
});
