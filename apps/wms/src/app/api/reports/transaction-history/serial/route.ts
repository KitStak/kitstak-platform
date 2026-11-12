/** `GET /api/reports/transaction-history/serial` — Serial Number Transaction History (M13). */
import { SERIAL_TRANSACTIONS_DEF } from "@/lib/grid-defs/reports/logs";
import { reportListRoute } from "@/server/repositories/reports-api";
import { listSerialTransactions } from "@/server/repositories/reports-logs";

export const GET = reportListRoute(SERIAL_TRANSACTIONS_DEF, listSerialTransactions);
