/**
 * `POST /api/printouts/[id]/render` `{ orderIds }` — prints real records with this template's
 * saved layout (PDF, inline). Used by template-aware printing (REQ-1) and the list "Preview".
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema, idSchema } from "@/server/repositories/platform-common";
import { getPrintout, previewPdf } from "@/server/repositories/printouts";

export const POST = defineRoute({
  // Template designers, or anyone allowed to print the source documents. Records are further
  // scoped to the caller's warehouses and clients in `orderRecord` (out-of-scope ids are dropped).
  permission: [
    "settings.printouts_labels.view", "settings.printouts_labels.create", "settings.printouts_labels.edit",
    "fulfillment.shipment_orders.print_packing_slip", "fulfillment.shipment_orders.print_picking_list",
    "fulfillment.shipment_orders.batch_picking_list", "fulfillment.packing_station.print_packing_slip",
  ],
  params: idParamsSchema,
  body: z.object({ orderIds: z.array(idSchema).max(200).default([]) }),
  transaction: false,
  handler: async ({ db, auth, params, body }) => {
    const t = getPrintout(db, params.id);
    const bytes = await previewPdf(db, auth, t.typeKey, t.layout, body.orderIds);
    return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${t.name.replace(/[^A-Za-z0-9 _-]/g, "")}.pdf"` } });
  },
});
