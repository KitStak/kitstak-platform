/**
 * `GET /api/pickers/orders/grid` — shipment-order grid rows for the shared "Add order(s)" drawer.
 * Grid grammar (q, qm, f.*, sort, page, ps) plus `clientId`, `warehouseId`, `status=a,b`; scoped.
 */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listOrderPickerGrid } from "@/server/repositories/platform-order-picker";

export const GET = defineRoute({
  handler: async ({ db, auth, searchParams }) => {
    const { rows, total, page, pageSize } = await listOrderPickerGrid(db, auth.viewScope, searchParams);
    return listResult(rows, { total, page, pageSize });
  },
});
