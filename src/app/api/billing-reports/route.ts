/** `GET /api/billing-reports` — Billing Report grid (optional `contractId`). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listReports } from "@/server/repositories/billing-reports";

export const GET = defineRoute({
  permission: ["settings.billing_report.view", "settings.billing.view"],
  query: z.object({ contractId: z.string().max(64).optional() }).passthrough(),
  handler: async ({ db, auth, grid, query }) => {
    const q = grid();
    const { rows, total } = await listReports(db, auth, q, query.contractId ?? null);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
