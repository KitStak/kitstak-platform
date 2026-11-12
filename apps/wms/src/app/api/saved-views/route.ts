/** `/api/saved-views?gridKey=` — own + shared views (GET) and save a view (POST). */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { createSavedView, listSavedViews, savedViewCreateSchema, savedViewListQuerySchema } from "@/server/repositories/platform-user-prefs";

export const GET = defineRoute({
  query: savedViewListQuerySchema,
  handler: async ({ db, auth, query }) => await listSavedViews(db, auth.user.id, query.gridKey),
});

export const POST = defineRoute({
  body: savedViewCreateSchema,
  handler: async ({ db, auth, body }) => created(await createSavedView(db, auth.user.id, body)),
});
