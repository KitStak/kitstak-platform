/** `GET /api/reports/user-performance` — User Performance Report (M13). */
import { USER_PERFORMANCE_DEF } from '@/lib/grid-defs/reports/receiving';
import { reportListRoute } from '@/server/repositories/reports-api';
import { listUserPerformance } from '@/server/repositories/reports-receiving';

export const GET = reportListRoute(USER_PERFORMANCE_DEF, listUserPerformance);
