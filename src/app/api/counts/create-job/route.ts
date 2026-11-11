/**
 * `POST /api/counts/create-job` — Create Job for Pending plans: `{ ids, jobTypeId, batchSize, assigneeUserId? }` → `{ succeeded, failed, jobIds }`.
 * `GET /api/counts/create-job?ids=a,b` — preview: batch units (stocked locations) per plan, so the modal shows the real job count.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { createCountJobs, createCountJobSchema, previewCountJobs } from "@/server/repositories/counts-jobs";
import { domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: P.createJob,
  body: createCountJobSchema,
  handler: async ({ db, auth, actor, body }) => await createCountJobs(db, domainCtx(actor, auth), auth, body),
});

export const GET = defineRoute({
  permission: P.createJob,
  query: z.object({
    ids: z.string().min(1, "Select at least one count plan").max(70_000)
      .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(z.string().min(1).max(64)).min(1).max(1000)),
  }),
  handler: async ({ db, auth, query }) => await previewCountJobs(db, auth, query.ids),
});
