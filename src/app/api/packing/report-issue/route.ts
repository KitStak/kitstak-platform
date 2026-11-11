/** `POST /api/packing/report-issue` — move the order's picked stock to a hospital location; Pack Short Open. */
import { defineRoute } from "@/server/api/define-route";
import { reportIssue, reportIssueSchema } from "@/server/repositories/packing";
import { PACKING_PERMISSIONS } from "@/server/repositories/packing-scan";
import { scopedCtx } from "@/server/repositories/returns";

export const POST = defineRoute({
  permission: PACKING_PERMISSIONS.reportIssue,
  body: reportIssueSchema,
  handler: async ({ db, auth, actor, body }) => await reportIssue(db, scopedCtx(actor, auth), body),
});
