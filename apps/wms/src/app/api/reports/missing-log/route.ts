/** `GET /api/reports/missing-log` — Missing Log (M13). */
import { MISSING_LOG_DEF } from '@/lib/grid-defs/reports/logs';
import { reportListRoute } from '@/server/repositories/reports-api';
import { listMissingLog } from '@/server/repositories/reports-logs';

export const GET = reportListRoute(MISSING_LOG_DEF, listMissingLog);
