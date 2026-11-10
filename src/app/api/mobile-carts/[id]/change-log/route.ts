/** `GET /api/mobile-carts/[id]/change-log` — field-level history (no catalog change-log key for carts; view gates it). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadMobileCart } from "@/server/repositories/mobile-carts";

export const GET = defineRoute({
  permission: "settings.mobile_carts.view",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    loadMobileCart(db, auth, params.id);
    return changeLogResult(db, "mobile_cart", params.id, query);
  },
});
