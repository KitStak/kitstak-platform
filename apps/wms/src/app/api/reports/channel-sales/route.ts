/** `GET /api/reports/channel-sales` — Channel Sales Report (M13). */
import { CHANNEL_SALES_DEF } from '@/lib/grid-defs/reports/orders';
import { reportListRoute } from '@/server/repositories/reports-api';
import { listChannelSales } from '@/server/repositories/reports-orders';

export const GET = reportListRoute(CHANNEL_SALES_DEF, listChannelSales);
