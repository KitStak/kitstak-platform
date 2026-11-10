/** `GET|PATCH|DELETE /api/carriers/[id]` — Edit Connection (5 tabs) and guarded delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { editCarrierSchema } from "@/lib/grid-defs/integrations/carriers";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteCarrierConnections, getCarrierConnection, updateCarrierConnection } from "@/server/repositories/carriers";

export const GET = defineRoute({
  permission: ["integrations.integrations.create_setup", "integrations.integrations.edit_setup", "integrations.integrations.delete_setup", "integrations.carrier_monitoring.view"],
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getCarrierConnection(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "integrations.integrations.edit_setup",
  params: idParamsSchema,
  body: editCarrierSchema,
  transaction: false,
  handler: async ({ db, auth, actor, params, body }) => updateCarrierConnection(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "integrations.integrations.delete_setup",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => {
    const result = deleteCarrierConnections(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
