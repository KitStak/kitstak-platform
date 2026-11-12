/** `POST /api/screen-configs/bulk-status` `{ ids, isActive }` — activate / deactivate; per-id result. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema } from "@/lib/grid-defs/admin/common";
import { setScreenConfigsActive } from "@/server/repositories/screen-configs";

export const POST = defineRoute({
  permission: "settings.screen_configuration.edit",
  body: bulkIdsSchema.extend({ isActive: z.boolean() }),
  handler: async ({ db, auth, actor, body }) => await setScreenConfigsActive(db, auth, actor, body.ids, body.isActive),
});
