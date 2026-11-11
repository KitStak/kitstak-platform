/** `GET /api/products/check-barcodes?barcodes=a,b&excludeProductId=` — where barcodes are already used. M09. */
import { defineRoute } from "@/server/api/define-route";
import { barcodeCheckSchema, checkBarcodes } from "@/server/repositories/products-options";

export const GET = defineRoute({
  permission: ["settings.products.create", "settings.products.edit"],
  query: barcodeCheckSchema,
  handler: async ({ db, auth, query }) => await checkBarcodes(db, auth.scope, query),
});
