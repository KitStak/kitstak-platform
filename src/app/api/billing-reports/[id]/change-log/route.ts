/** `GET /api/billing-reports/[id]/change-log` — history of one bill. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadReport, REPORT_ENTITY } from "@/server/repositories/billing-reports";

export const GET = defineRoute({
  permission: ["settings.billing_report.view", "settings.billing.view"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    await loadReport(db, auth, params.id);
    return await changeLogResult(db, REPORT_ENTITY, params.id, query);
  },
});
