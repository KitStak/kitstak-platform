/** `GET /api/warehouses/[id]/locations?area=Receiving,Returns` — default-location picker options. */
import { z } from "zod";
import { AREA_TYPES } from "@/lib/enums";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { warehouseLocationOptions } from "@/server/repositories/warehouses";

const query = z.object({
  area: z.string().trim().max(200).optional().transform((v) => (v ? v.split(",").map((a) => a.trim()).filter((a) => (AREA_TYPES as readonly string[]).includes(a)) : [])),
});

export const GET = defineRoute({
  permission: ["settings.warehouse.view", "settings.shipment_packages.view"],
  params: idParamsSchema,
  query,
  handler: ({ db, auth, params, query: q }) => warehouseLocationOptions(db, auth, params.id, q.area),
});
