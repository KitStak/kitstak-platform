/** `POST /api/notifications/read` — `{ ids }` or `{ all: true }` marks the caller's notifications read. */
import { defineRoute } from "@/server/api/define-route";
import { markNotificationsRead, notificationReadSchema } from "@/server/repositories/platform-activity";

export const POST = defineRoute({
  body: notificationReadSchema,
  handler: ({ db, auth, body }) => markNotificationsRead(db, auth.user.id, body),
});
