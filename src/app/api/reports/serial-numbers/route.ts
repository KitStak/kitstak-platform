/** `GET /api/reports/serial-numbers` — Serial Number Tracking (M13). */
import { SERIAL_TRACKING_DEF } from "@/lib/grid-defs/reports/inventory";
import { reportListRoute } from "@/server/repositories/reports-api";
import { listSerialTracking } from "@/server/repositories/reports-inventory";

export const GET = reportListRoute(SERIAL_TRACKING_DEF, listSerialTracking);
