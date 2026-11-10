/** `GET /api/mobile-carts` — Mobile Carts grid (grid grammar; status derived from the open job). `POST` — create (cart + cell list). */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { mobileCartSchema } from "@/lib/grid-defs/facility/mobile-carts";
import { createMobileCart, listMobileCarts } from "@/server/repositories/mobile-carts";

export const GET = defineRoute({
  permission: "settings.mobile_carts.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listMobileCarts(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.mobile_carts.create",
  body: mobileCartSchema,
  handler: ({ db, auth, actor, body }) => created(createMobileCart(db, auth, actor, body)),
});
