/** `GET /api/reports/inventory-aging` — Inventory Aging Report (M13). */
import { AGING_DEF } from "@/lib/grid-defs/reports/analysis";
import { reportListRoute } from "@/server/repositories/reports-api";
import { listAging } from "@/server/repositories/reports-analysis";

export const GET = reportListRoute(AGING_DEF, listAging);
