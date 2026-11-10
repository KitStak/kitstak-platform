/** `POST /api/warehouses/[id]/set-default` — makes this the company default warehouse. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { setDefaultWarehouse } from "@/server/repositories/warehouses";

export const POST = defineRoute({
  permission: "settings.warehouse.edit",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => setDefaultWarehouse(db, auth, actor, params.id),
});
