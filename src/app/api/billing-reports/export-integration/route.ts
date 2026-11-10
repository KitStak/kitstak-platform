/** `POST /api/billing-reports/export-integration { ids, force? }` — push Approved bills to the accounting integration (R2-7). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { exportReportsToIntegration } from "@/server/repositories/billing-reports";

export const POST = defineRoute({
  permission: "settings.billing_report.approve",
  body: bulkIds.extend({ force: z.boolean().optional() }),
  handler: ({ db, auth, actor, body }) => exportReportsToIntegration(db, auth, actor, body.ids, { force: body.force }),
});
