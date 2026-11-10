/** `GET /api/reports/order-inventory` — Order Inventory (M13). */
import { ORDER_INVENTORY_DEF } from "@/lib/grid-defs/reports/orders";
import { reportListRoute } from "@/server/repositories/reports-api";
import { listOrderInventory } from "@/server/repositories/reports-orders";

export const GET = reportListRoute(ORDER_INVENTORY_DEF, listOrderInventory);
