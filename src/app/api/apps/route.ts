/** `GET /api/apps` — every app with activation state, settings and the catalog presentation. */
import { defineRoute } from "@/server/api/define-route";
import { listApps } from "@/server/repositories/apps";

export const GET = defineRoute({
  handler: ({ db }) => listApps(db),
});
