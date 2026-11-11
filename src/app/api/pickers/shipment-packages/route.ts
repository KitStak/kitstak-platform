/** `GET /api/pickers/shipment-packages?q=&mode=&limit=&ids=&warehouseId=&clientId=` — scoped picker options. */
import { defineRoute } from "@/server/api/define-route";
import { pickerQuerySchema, runNamedPicker } from "@/server/repositories/platform-pickers";

export const GET = defineRoute({
  query: pickerQuerySchema,
  handler: async ({ db, auth, query, searchParams }) =>
    await runNamedPicker(db, "shipment-packages", auth.viewScope, query, Object.fromEntries(searchParams.entries())),
});
