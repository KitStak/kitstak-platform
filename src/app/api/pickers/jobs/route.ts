/** `GET /api/pickers/jobs?q=&mode=&limit=&ids=&warehouseId=&clientId=` — scoped picker options. */
import { defineRoute } from "@/server/api/define-route";
import { pickerQuerySchema, runNamedPicker } from "@/server/repositories/platform-pickers";

export const GET = defineRoute({
  query: pickerQuerySchema,
  handler: ({ db, auth, query, searchParams }) =>
    runNamedPicker(db, "jobs", auth.viewScope, query, Object.fromEntries(searchParams.entries())),
});
