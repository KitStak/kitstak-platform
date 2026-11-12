/** `GET /api/reports/export-history` — Excel Export History (M13). */
import { EXPORT_HISTORY_DEF } from '@/lib/grid-defs/reports/logs';
import { reportListRoute } from '@/server/repositories/reports-api';
import { listExportHistory } from '@/server/repositories/reports-logs';

export const GET = reportListRoute(EXPORT_HISTORY_DEF, listExportHistory);
