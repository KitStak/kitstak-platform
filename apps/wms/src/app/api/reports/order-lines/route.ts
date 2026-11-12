/** `GET /api/reports/order-lines` — Order Line Progress (M13): the dashboard's Order Lines drilldown. */
import { ORDER_LINES_DEF } from "@/lib/grid-defs/reports/order-lines";
import { reportListRoute } from "@/server/repositories/reports-api";
import { listOrderLines } from "@/server/repositories/reports-order-lines";

export const GET = reportListRoute(ORDER_LINES_DEF, listOrderLines);
