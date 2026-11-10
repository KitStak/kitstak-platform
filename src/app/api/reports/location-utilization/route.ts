/** `GET /api/reports/location-utilization` — Location Utilization Report (M13). */
import { UTILIZATION_DEF } from "@/lib/grid-defs/reports/analysis";
import { reportListRoute } from "@/server/repositories/reports-api";
import { listUtilization } from "@/server/repositories/reports-analysis";

export const GET = reportListRoute(UTILIZATION_DEF, listUtilization);
