/** `GET /api/vas-operations/creators` — users who created VAS operations in the caller's scope (Created by filter). */
import { defineRoute } from "@/server/api/define-route";
import { vasCreators } from "@/server/repositories/vas";

export const GET = defineRoute({
  permission: ["settings.vas_operations.view", "settings.billing.view"],
  handler: ({ db, auth }) => vasCreators(db, auth),
});
