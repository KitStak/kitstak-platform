/** `GET /api/reports/serial-numbers/receiving-history` — Serial Number Receiving History (M13). */
import { SERIAL_RECEIPTS_DEF } from '@/lib/grid-defs/reports/inventory';
import { reportListRoute } from '@/server/repositories/reports-api';
import { listSerialReceipts } from '@/server/repositories/reports-inventory';

export const GET = reportListRoute(SERIAL_RECEIPTS_DEF, listSerialReceipts);
