/** `POST /api/jobs/labels` `{ ids, op: create|reprint|void }` — shipping labels for the jobs' orders. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { withM03Actor } from "@/server/repositories/jobs-actor";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { JOB_PERMISSIONS } from "@/server/repositories/jobs";
import { runJobLabels } from "@/server/repositories/jobs-labels";

export const POST = defineRoute({
  permission: JOB_PERMISSIONS.label,
  transaction: false,
  body: z.object({ ids: bulkIdsSchema, op: z.enum(["create", "reprint", "void"]) }),
  handler: async ({ db, auth, actor, body }) => await withM03Actor(db, actor, auth, () => runJobLabels(db, auth, domainCtx(actor, auth), { jobIds: body.ids, op: body.op })),
});
