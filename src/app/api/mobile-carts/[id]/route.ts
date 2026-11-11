/** `GET|PATCH|DELETE /api/mobile-carts/[id]` — detail with cells, edit (optimistic `version`), delete (Available carts only). */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { mobileCartSchema } from "@/lib/grid-defs/facility/mobile-carts";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteMobileCarts, getMobileCart, updateMobileCart } from "@/server/repositories/mobile-carts";

export const GET = defineRoute({
  permission: ["settings.mobile_carts.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getMobileCart(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.mobile_carts.edit",
  params: idParamsSchema,
  body: mobileCartSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateMobileCart(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "settings.mobile_carts.delete",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteMobileCarts(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
