/** `POST /api/orders/print-records` `{ type, ids }` — renderer records + ineligible orders for Bulk Print. Read-only. */
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { buildPrintRecords, printRecordsSchema } from "@/server/repositories/orders-print";

const PRINT_PERMISSIONS = [ORDER_PERMISSIONS.printPackingSlip, ORDER_PERMISSIONS.printPickList, ORDER_PERMISSIONS.batchPickList, ORDER_PERMISSIONS.printManifest, ORDER_PERMISSIONS.pickPackShortLabel, ORDER_PERMISSIONS.reprintLabel];

export const POST = defineRoute({
  permission: PRINT_PERMISSIONS,
  body: printRecordsSchema,
  transaction: false,
  rateLimit: false,
  handler: async ({ db, auth, body }) => await buildPrintRecords(db, auth.scope, body),
});
