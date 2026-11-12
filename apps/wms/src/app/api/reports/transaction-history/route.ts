/** `GET /api/reports/transaction-history` — Transaction History (M13). */
import { TRANSACTION_HISTORY_DEF } from "@/lib/grid-defs/reports/logs";
import { reportListRoute } from "@/server/repositories/reports-api";
import { listTransactions } from "@/server/repositories/reports-logs";

export const GET = reportListRoute(TRANSACTION_HISTORY_DEF, listTransactions);
