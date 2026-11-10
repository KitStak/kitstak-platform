/** `POST /api/products/[id]/status` { status, version? } — activate / deactivate one product. M09. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { domainCtx, idParamsSchema, versionSchema } from "@/server/repositories/platform-common";
import { setProductStatus } from "@/server/repositories/products-commands";

export const POST = defineRoute({
  permission: "settings.products.edit",
  params: idParamsSchema,
  body: z.object({ status: z.enum(["Active", "Inactive"]), version: versionSchema.optional() }),
  handler: ({ db, auth, actor, params, body }) => {
    const row = setProductStatus(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.id, body.status, body.version);
    return { id: row.id, status: row.status, version: row.version };
  },
});
