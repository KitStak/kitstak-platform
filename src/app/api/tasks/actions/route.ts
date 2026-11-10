/**
 * `POST /api/tasks/actions` — Task Details operations:
 *   execute { ids, targetLocationId, targetLpId?, qty?, createResolutionJob?, note? } (all or nothing)
 *   update  { ids:[id], targetLocationId?, targetLpId?, moveToJobId? }
 *   cancel  { ids } (per id) · assign { ids, userId } · unassign { ids }
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { forbiddenError } from "@/server/api/errors";
import { can } from "@/server/auth/permissions";
import { tasks } from "@/server/domain";
import { bulkIdsSchema, domainCtx, idSchema } from "@/server/repositories/platform-common";
import { cancelTasks } from "@/server/repositories/platform-ops";
import { assignTasks } from "@/server/repositories/tasks";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("execute"), ids: bulkIdsSchema, targetLocationId: idSchema, targetLpId: idSchema.nullish(),
    qty: z.number().int().min(0).optional(), createResolutionJob: z.boolean().optional(), note: z.string().trim().max(500).nullish(),
  }),
  z.object({ action: z.literal("update"), ids: z.array(idSchema).length(1, "Select one task to update"), targetLocationId: idSchema.nullish(), targetLpId: idSchema.nullish(), moveToJobId: idSchema.optional() }),
  z.object({ action: z.literal("cancel"), ids: bulkIdsSchema }),
  z.object({ action: z.literal("assign"), ids: bulkIdsSchema, userId: idSchema }),
  z.object({ action: z.literal("unassign"), ids: bulkIdsSchema }),
]);

const PERMISSION = {
  execute: "fulfillment.task_details.execute_task",
  update: "fulfillment.task_details.update_task",
  cancel: "fulfillment.task_details.cancel_task",
  assign: "fulfillment.task_details.update_task",
  unassign: "fulfillment.task_details.update_task",
} as const;

export const POST = defineRoute({
  permission: Object.values(PERMISSION),
  body,
  handler: ({ db, auth, actor, body: input }) => {
    if (!can(auth, PERMISSION[input.action])) throw forbiddenError();
    const ctx = domainCtx(actor, auth);
    switch (input.action) {
      case "execute": {
        const results = tasks.execute(db, ctx, {
          taskIds: input.ids, targetLocationId: input.targetLocationId, targetLpId: input.targetLpId ?? null,
          qty: input.ids.length === 1 ? input.qty : undefined, createResolutionJob: input.createResolutionJob, note: input.note ?? null,
        });
        return { succeeded: input.ids, failed: [], results };
      }
      case "update": {
        const task = tasks.update(db, ctx, { taskId: input.ids[0], targetLocationId: input.targetLocationId, targetLpId: input.targetLpId, moveToJobId: input.moveToJobId });
        return { succeeded: [task.id], failed: [] };
      }
      case "cancel":
        return cancelTasks(db, ctx, input.ids);
      case "assign":
        return assignTasks(db, ctx, { ids: input.ids, userId: input.userId });
      case "unassign":
        return assignTasks(db, ctx, { ids: input.ids, userId: null });
    }
  },
});
