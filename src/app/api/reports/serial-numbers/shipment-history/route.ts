/** `GET /api/reports/serial-numbers/shipment-history` — Serial Number Shipment History (M13). */
import { SERIAL_SHIPMENTS_DEF } from "@/lib/grid-defs/reports/inventory";
import { reportListRoute } from "@/server/repositories/reports-api";
import { listSerialShipments } from "@/server/repositories/reports-inventory";

export const GET = reportListRoute(SERIAL_SHIPMENTS_DEF, listSerialShipments);
