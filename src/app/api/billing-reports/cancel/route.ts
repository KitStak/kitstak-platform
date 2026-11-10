/** `POST /api/billing-reports/cancel { ids }` — Cancel bills (final). */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { cancelReports } from "@/server/repositories/billing-reports";

export const POST = defineRoute({
  permission: "settings.billing_report.cancel",
  body: bulkIds,
  handler: ({ db, auth, actor, body }) => cancelReports(db, auth, actor, body.ids),
});
