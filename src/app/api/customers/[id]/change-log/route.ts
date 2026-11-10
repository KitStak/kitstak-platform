/** `GET /api/customers/[id]/change-log` — field-level history of one customer. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadCustomer } from "@/server/repositories/customers";

export const GET = defineRoute({
  permission: "settings.customers.view",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    loadCustomer(db, auth, params.id);
    return changeLogResult(db, "customer", params.id, query);
  },
});
