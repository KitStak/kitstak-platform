/** `GET|PATCH|DELETE /api/billing-reports/[id]` — header strip + consolidated lines, Edit Info (bill number, status), Draft-only delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { billInfoSchema } from "@/lib/grid-defs/organization/billing-reports";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteReports, getReport, updateReportInfo } from "@/server/repositories/billing-reports";

export const GET = defineRoute({
  permission: ["settings.billing_report.view", "settings.billing.view"],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getReport(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.billing_report.approve",
  params: idParamsSchema,
  body: billInfoSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateReportInfo(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "settings.billing_report.delete",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteReports(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
