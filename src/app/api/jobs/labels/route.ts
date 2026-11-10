/** `POST /api/jobs/labels` `{ ids, op: create|reprint|void }` — shipping labels for the jobs' orders. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { JOB_PERMISSIONS } from "@/server/repositories/jobs";
import { runJobLabels } from "@/server/repositories/jobs-labels";

export const POST = defineRoute({
  permission: JOB_PERMISSIONS.label,
  transaction: false,
  body: z.object({ ids: bulkIdsSchema, op: z.enum(["create", "reprint", "void"]) }),
  handler: ({ db, auth, actor, body }) => runJobLabels(db, auth, domainCtx(actor, auth), { jobIds: body.ids, op: body.op }),
});
