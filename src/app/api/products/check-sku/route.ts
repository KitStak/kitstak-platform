/** `GET /api/products/check-sku?clientId=&sku=&excludeId=` — inline per-client SKU uniqueness. M09. */
import { defineRoute } from "@/server/api/define-route";
import { checkSku, skuCheckSchema } from "@/server/repositories/products-options";

export const GET = defineRoute({
  permission: ["settings.products.create", "settings.products.edit"],
  query: skuCheckSchema,
  handler: async ({ db, auth, query }) => await checkSku(db, auth.scope, query),
});
