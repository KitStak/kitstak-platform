/** `/api/grid-prefs/[gridKey]` — the caller's column chooser state (null until saved). */
import { defineRoute } from "@/server/api/define-route";
import { getGridPrefs, gridPrefsParamsSchema, gridPrefsSchema, putGridPrefs } from "@/server/repositories/platform-user-prefs";

export const GET = defineRoute({
  params: gridPrefsParamsSchema,
  handler: async ({ db, auth, params }) => await getGridPrefs(db, auth.user.id, params.gridKey),
});

export const PUT = defineRoute({
  params: gridPrefsParamsSchema,
  body: gridPrefsSchema,
  handler: async ({ db, auth, params, body }) => await putGridPrefs(db, auth.user.id, params.gridKey, body),
});
