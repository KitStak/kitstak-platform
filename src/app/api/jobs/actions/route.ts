/**
 * `POST /api/jobs/actions` — Job Management bulk actions (BUILD_PLAN 0.2 bulk contract):
 *   { action: "priority", ids, priority } · { action: "cancel", ids }
 *   { action: "assign", ids, userId } · { action: "unassign", ids } · { action: "markPrinted", ids }
 * Returns `{ succeeded, failed }`. Each action checks its own permission key.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { forbiddenError } from "@/server/api/errors";
import { can } from "@/server/auth/permissions";
import { jobs } from "@/server/domain";
import { bulkIdsSchema, domainCtx, idSchema } from "@/server/repositories/platform-common";
import { JOB_PERMISSIONS, assertSameWarehouse, cancelJobs, markPickListPrinted } from "@/server/repositories/jobs";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("priority"), ids: bulkIdsSchema, priority: z.enum(["None", "Low", "Medium", "High", "Urgent"]) }),
  z.object({ action: z.literal("cancel"), ids: bulkIdsSchema }),
  z.object({ action: z.literal("assign"), ids: bulkIdsSchema, userId: idSchema }),
  z.object({ action: z.literal("unassign"), ids: bulkIdsSchema }),
  z.object({ action: z.literal("markPrinted"), ids: bulkIdsSchema }),
]);

const PERMISSION: Readonly<Record<z.output<typeof body>["action"], string>> = {
  priority: JOB_PERMISSIONS.priority,
  cancel: JOB_PERMISSIONS.cancel,
  assign: JOB_PERMISSIONS.assign,
  unassign: JOB_PERMISSIONS.unassign,
  markPrinted: JOB_PERMISSIONS.pickList,
};

export const POST = defineRoute({
  permission: Object.values(PERMISSION),
  body,
  handler: ({ db, auth, actor, body: input }) => {
    if (!can(auth, PERMISSION[input.action])) throw forbiddenError();
    const ctx = domainCtx(actor, auth);
    switch (input.action) {
      case "priority":
        return jobs.updatePriority(db, ctx, { jobIds: input.ids, priority: input.priority });
      case "cancel":
        return cancelJobs(db, ctx, input.ids);
      case "assign":
        assertSameWarehouse(db, input.ids);
        return jobs.assign(db, ctx, { jobIds: input.ids, userId: input.userId });
      case "unassign":
        assertSameWarehouse(db, input.ids);
        return jobs.unassign(db, ctx, { jobIds: input.ids });
      case "markPrinted":
        markPickListPrinted(db, ctx, input.ids);
        return { succeeded: input.ids, failed: [] };
    }
  },
});
