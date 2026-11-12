/** `GET|PATCH|DELETE /api/customers/[id]` — detail with addresses, edit (optimistic `version`), delete (blocked while orders exist). */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { customerSchema } from "@/lib/grid-defs/organization/customers";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteCustomers, getCustomer, updateCustomer } from "@/server/repositories/customers";

export const GET = defineRoute({
  permission: "settings.customers.view",
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getCustomer(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.customers.edit",
  params: idParamsSchema,
  body: customerSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateCustomer(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "settings.customers.delete",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteCustomers(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
