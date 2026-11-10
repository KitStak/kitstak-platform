/** `POST /api/mobile-carts/[id]/duplicate { code }` — copies the cart and its cell layout under a new code. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { duplicateCartSchema } from "@/lib/grid-defs/facility/mobile-carts";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { duplicateMobileCart } from "@/server/repositories/mobile-carts";

export const POST = defineRoute({
  permission: "settings.mobile_carts.duplicate",
  params: idParamsSchema,
  body: duplicateCartSchema,
  handler: ({ db, auth, actor, params, body }) => created(duplicateMobileCart(db, auth, actor, params.id, body.code)),
});
