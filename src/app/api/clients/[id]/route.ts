/** `GET|PATCH|DELETE /api/clients/[id]` — detail (KPIs, settings, addresses, users, contracts), full edit (optimistic `version`), guarded delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { clientSchema } from "@/lib/grid-defs/organization/clients";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteClients, getClient, updateClient } from "@/server/repositories/clients";

export const GET = defineRoute({
  permission: "settings.clients.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getClient(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.clients.edit",
  params: idParamsSchema,
  body: clientSchema,
  handler: ({ db, auth, actor, params, body }) => updateClient(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "settings.clients.delete",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => {
    const result = deleteClients(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
