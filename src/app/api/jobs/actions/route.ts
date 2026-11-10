/**
 * `POST /api/jobs/actions` — Job Management bulk actions (BUILD_PLAN 0.2 bulk contract):
 *   { action: "priority", ids, priority } · { action: "cancel", ids }
 *   { action: "assign", ids, userId } · { action: "unassign", ids } · { action: "markPrinted", ids }
 * Every action takes an optional `versions: { [jobId]: version }`; a stale id fails with CONFLICT.
 * Returns `{ succeeded, failed }` (cancel also returns `message` and per-job `outcomes`).
 * Each action checks its own permission key.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { withM03Actor } from "@/server/repositories/jobs-actor";
import { bulkIdsSchema, domainCtx, idSchema } from "@/server/repositories/platform-common";
import { JOB_PERMISSIONS, assertSameWarehouse, markPickListPrinted } from "@/server/repositories/jobs";
import { assertJobAction } from "@/server/repositories/jobs-policy";
import { assignJobs, cancelJobs, updateJobsPriority } from "@/server/repositories/jobs-commands";

const versions = z.record(z.string(), z.number().int().positive()).optional();

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("priority"), ids: bulkIdsSchema, priority: z.enum(["None", "Low", "Medium", "High", "Urgent"]), versions }),
  z.object({ action: z.literal("cancel"), ids: bulkIdsSchema, versions }),
  z.object({ action: z.literal("assign"), ids: bulkIdsSchema, userId: idSchema, versions }),
  z.object({ action: z.literal("unassign"), ids: bulkIdsSchema, versions }),
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
  handler: ({ db, auth, actor, body: input }) => withM03Actor(db, actor, auth, () => {
    // Floor-only roles are denied supervisor-only keys even when the role still holds them (critic R4).
    assertJobAction(auth, PERMISSION[input.action]);
    const ctx = domainCtx(actor, auth);
    switch (input.action) {
      case "priority":
        return updateJobsPriority(db, ctx, input.ids, input.priority, input.versions);
      case "cancel":
        return cancelJobs(db, ctx, input.ids, input.versions);
      case "assign":
        assertSameWarehouse(db, input.ids);
        return assignJobs(db, ctx, input.ids, input.userId, input.versions);
      case "unassign":
        assertSameWarehouse(db, input.ids);
        return assignJobs(db, ctx, input.ids, null, input.versions);
      case "markPrinted":
        markPickListPrinted(db, ctx, input.ids);
        return { succeeded: input.ids, failed: [] };
    }
  }),
});
