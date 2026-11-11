/** `/api/saved-views/[id]` — read (own or shared), update and delete (owner only). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteSavedView, getSavedView, savedViewUpdateSchema, updateSavedView } from "@/server/repositories/platform-user-prefs";

export const GET = defineRoute({
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getSavedView(db, auth.user.id, params.id),
});

export const PATCH = defineRoute({
  params: idParamsSchema,
  body: savedViewUpdateSchema,
  handler: async ({ db, auth, params, body }) => await updateSavedView(db, auth.user.id, params.id, body),
});

export const DELETE = defineRoute({
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await deleteSavedView(db, auth.user.id, params.id),
});
