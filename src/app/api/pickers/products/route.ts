/** `GET /api/pickers/products?q=&mode=&limit=&ids=&warehouseId=&clientId=` — scoped picker options. */
import { defineRoute } from "@/server/api/define-route";
import { pickerQuerySchema, runNamedPicker } from "@/server/repositories/platform-pickers";

export const GET = defineRoute({
  query: pickerQuerySchema,
  handler: ({ db, auth, query, searchParams }) =>
    runNamedPicker(db, "products", auth.viewScope, query, Object.fromEntries(searchParams.entries())),
});
