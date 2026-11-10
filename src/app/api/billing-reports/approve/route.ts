/** `POST /api/billing-reports/approve { ids }` — Approve bills (approved bills can't be deleted). */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { approveReports } from "@/server/repositories/billing-reports";

export const POST = defineRoute({
  permission: "settings.billing_report.approve",
  body: bulkIds,
  handler: ({ db, auth, actor, body }) => approveReports(db, auth, actor, body.ids),
});
