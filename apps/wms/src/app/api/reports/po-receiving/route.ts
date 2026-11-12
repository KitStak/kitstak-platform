/** `GET /api/reports/po-receiving` — PO Receiving Report (M13). */
import { PO_RECEIVING_DEF } from '@/lib/grid-defs/reports/receiving';
import { reportListRoute } from '@/server/repositories/reports-api';
import { listPoReceiving } from '@/server/repositories/reports-receiving';

export const GET = reportListRoute(PO_RECEIVING_DEF, listPoReceiving);
