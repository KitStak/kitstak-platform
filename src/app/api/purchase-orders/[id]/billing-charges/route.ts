/** `GET /api/purchase-orders/[id]/billing-charges` — latest PO billing charges as .xlsx. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { billingChargesWorkbook } from "@/server/repositories/purchase-orders-print";

export const GET = defineRoute({
  permission: "inventory.purchase_orders.download_billing_charges",
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => {
    const { bytes, fileName } = await billingChargesWorkbook(db, auth.scope, params.id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "cache-control": "no-store",
      },
    });
  },
});
