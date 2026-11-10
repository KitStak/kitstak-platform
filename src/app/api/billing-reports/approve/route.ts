/**
 * `POST /api/billing-reports/approve { ids, allowOpenPeriod? }` — Approve bills (approved bills can't be deleted).
 * A bill whose period hasn't ended is refused unless `allowOpenPeriod` (the UI confirms first).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { approveReports } from "@/server/repositories/billing-reports";

export const POST = defineRoute({
  permission: "settings.billing_report.approve",
  body: bulkIds.extend({ allowOpenPeriod: z.boolean().optional() }),
  handler: ({ db, auth, actor, body }) => approveReports(db, auth, actor, body.ids, { allowOpenPeriod: body.allowOpenPeriod }),
});
