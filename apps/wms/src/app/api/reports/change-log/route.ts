/** `GET /api/reports/change-log` — Change Log (M13). */
import { CHANGE_LOG_DEF } from "@/lib/grid-defs/reports/logs";
import { reportListRoute } from "@/server/repositories/reports-api";
import { listChangeLog } from "@/server/repositories/reports-logs";

export const GET = reportListRoute(CHANGE_LOG_DEF, listChangeLog);
