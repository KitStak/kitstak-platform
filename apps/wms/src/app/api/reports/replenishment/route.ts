/** `GET /api/reports/replenishment` — Dynamic Replenishment Report (M13). */
import { REPLENISHMENT_DEF } from '@/lib/grid-defs/reports/inventory';
import { reportListRoute } from '@/server/repositories/reports-api';
import { listReplenishment } from '@/server/repositories/reports-inventory';

export const GET = reportListRoute(REPLENISHMENT_DEF, listReplenishment);
