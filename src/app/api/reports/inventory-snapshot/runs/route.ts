/**
 * `GET /api/reports/inventory-snapshot/runs` — snapshot coverage per warehouse in the viewer's
 * scope (M13): latest business day, number of days held, and business days with no snapshot
 * (scheduler gaps), so the report can say plainly which nights are missing.
 */
import { defineRoute } from "@/server/api/define-route";
import { result } from "@/server/api/envelope";
import { SNAPSHOT_DEF } from "@/lib/grid-defs/reports/inventory";
import { snapshotCoverage } from "@/server/repositories/reports-inventory";

export const GET = defineRoute({
  name: "GET /api/reports/inventory-snapshot/runs",
  permission: SNAPSHOT_DEF.permission,
  handler: ({ db, auth }) => result(snapshotCoverage(db, auth)),
});
