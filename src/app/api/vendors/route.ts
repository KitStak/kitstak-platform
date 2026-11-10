/** `/api/vendors` — vendor list (grid grammar; `clientId` narrows for the PO wizard) and create. */
import { z } from "zod";
import { created, listResult } from "@/server/api/envelope";
import { defineRoute } from "@/server/api/define-route";
import { VENDOR_VIEW_PERMISSIONS, vendorFormSchema } from "@/lib/grid-defs/receiving/vendors";
import { domainCtx } from "@/server/repositories/platform-common";
import { createVendor, listVendors } from "@/server/repositories/vendors";

export const GET = defineRoute({
  permission: VENDOR_VIEW_PERMISSIONS,
  query: z.looseObject({ clientId: z.string().trim().max(64).optional(), active: z.enum(["1", "0"]).optional() }),
  handler: ({ db, auth, grid, query }) => {
    const q = grid();
    const { rows, total } = listVendors(db, auth, q, { clientId: query.clientId || null, activeOnly: query.active === "1" });
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.vendors.create",
  body: vendorFormSchema,
  handler: ({ db, auth, actor, body }) => created(createVendor(db, domainCtx(actor, auth), auth.scope, body)),
});
