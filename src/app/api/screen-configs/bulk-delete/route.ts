/** `POST /api/screen-configs/bulk-delete` `{ ids }` — deletes configurations; per-id result. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema } from "@/lib/grid-defs/admin/common";
import { deleteScreenConfigs } from "@/server/repositories/screen-configs";

export const POST = defineRoute({
  permission: "settings.screen_configuration.delete",
  body: bulkIdsSchema,
  handler: ({ db, auth, actor, body, audit }) => {
    const result = deleteScreenConfigs(db, auth, actor, body.ids);
    for (const id of result.succeeded) audit({ action: "screen_config.delete", entity: "screen_config", entityId: id });
    return result;
  },
});
