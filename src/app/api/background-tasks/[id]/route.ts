/** `GET /api/background-tasks/[id]` — one of the caller's tasks (polled by the tray). */
import { defineRoute } from "@/server/api/define-route";
import { getBackgroundTask } from "@/server/repositories/platform-activity";
import { idParamsSchema } from "@/server/repositories/platform-common";

export const GET = defineRoute({
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getBackgroundTask(db, auth.user.id, params.id),
});
