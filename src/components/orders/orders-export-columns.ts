/** Export column specs per view (the server provider uses the same defs). PURE. */
import { columnsForView, type OrderView } from "@/lib/grid-defs/orders/shipment-orders";

export function exportColumnsForView(view: OrderView): readonly { readonly key: string; readonly label: string }[] {
  return columnsForView(view).map((c) => ({ key: c.id, label: c.label }));
}
