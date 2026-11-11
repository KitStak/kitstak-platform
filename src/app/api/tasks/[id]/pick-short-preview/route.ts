/** `GET /api/tasks/[id]/pick-short-preview` — free stock elsewhere for a partial execute (Execute drawer). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { withBusyRetry } from "@/server/repositories/jobs-read-retry";
import { pickShortPreview } from "@/server/repositories/tasks-pick-short";

export const GET = defineRoute({
  permission: "fulfillment.task_details.execute_task",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => withBusyRetry(async () => await pickShortPreview(db, auth, params.id)),
});
