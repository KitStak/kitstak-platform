/** `GET /api/reports/inventory-snapshot` — Inventory Snapshot Report (M13). */
import { SNAPSHOT_DEF } from '@/lib/grid-defs/reports/inventory';
import { reportListRoute } from '@/server/repositories/reports-api';
import { listSnapshot } from '@/server/repositories/reports-inventory';

export const GET = reportListRoute(SNAPSHOT_DEF, listSnapshot);
