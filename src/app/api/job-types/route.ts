/** `GET /api/job-types?warehouseId&operationType` (grid) · `POST /api/job-types` (create). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { jobTypeInputSchema } from "@/lib/grid-defs/jobs/forms";
import { domainCtx } from "@/server/repositories/platform-common";
import { createJobType, listJobTypes } from "@/server/repositories/job-types";

export const GET = defineRoute({
  permission: ["settings.job_types.view", "automation.wave_rules.view"],
  query: z.object({ warehouseId: z.string().max(64).optional(), operationType: z.string().max(40).optional() }).passthrough(),
  handler: ({ db, auth, grid, query }) => {
    const g = grid();
    const { rows, total } = listJobTypes(db, auth, g, { warehouseId: query.warehouseId, operationType: query.operationType });
    return listResult(rows, { total, page: g.page, pageSize: g.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.job_types.create",
  body: jobTypeInputSchema,
  handler: ({ db, auth, actor, body }) => created(createJobType(db, auth, domainCtx(actor, auth), body)),
});
