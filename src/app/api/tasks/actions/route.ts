/**
 * `POST /api/tasks/actions` — Task Details operations:
 *   execute { ids, targetLocationId, targetLpId?, qty?, createResolutionJob?, note? } (all or nothing)
 *   update  { ids:[id], targetLocationId?, targetLpId?, moveToJobId? }
 *   cancel  { ids } (per id) · assign { ids, userId } · unassign { ids }
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { withM03Actor } from "@/server/repositories/jobs-actor";
import { tasks } from "@/server/domain";
import { bulkIdsSchema, domainCtx, idSchema } from "@/server/repositories/platform-common";
import { assertJobAction } from "@/server/repositories/jobs-policy";
import { cancelTasks } from "@/server/repositories/jobs-commands";
import { assignTasks } from "@/server/repositories/tasks";
import { pickShortPreview } from "@/server/repositories/tasks-pick-short";
import { sql } from "drizzle-orm";

/** Critic R3: the API speaks the same language as the Execute / Update dialogs. */
const targetLocation = z.string({ error: "Choose the target location" }).trim().min(1, "Choose the target location").max(64);

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("execute"), ids: bulkIdsSchema, targetLocationId: targetLocation, targetLpId: idSchema.nullish(),
    qty: z.number().int().min(0).optional(), createResolutionJob: z.boolean().optional(), note: z.string().trim().max(500).nullish(),
  }),
  z.object({ action: z.literal("update"), ids: z.array(idSchema).length(1, "Select one task to update"), targetLocationId: targetLocation.nullish(), targetLpId: idSchema.nullish(), moveToJobId: idSchema.optional() }),
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
  handler: ({ db, auth, actor, body: input }) => withM03Actor(db, actor, auth, () => {
    assertJobAction(auth, PERMISSION[input.action]);
    const ctx = domainCtx(actor, auth);
    switch (input.action) {
      case "execute": {
        // Critic R5: a single partial pick defaults to a resolution job when free stock exists
        // elsewhere (Logiwa behaviour). An explicit createResolutionJob: false is honoured.
        const single = input.ids.length === 1 ? input.ids[0] : undefined;
        let createResolutionJob = input.createResolutionJob;
        if (single && createResolutionJob === undefined && input.qty !== undefined) {
          const row = db.get<{ remaining: number }>(sql`SELECT planned_qty - actual_qty AS remaining FROM tasks WHERE id = ${single}`);
          if (row && input.qty < Number(row.remaining)) createResolutionJob = pickShortPreview(db, auth, single).suggestResolution;
        }
        const results = tasks.execute(db, ctx, {
          taskIds: input.ids, targetLocationId: input.targetLocationId, targetLpId: input.targetLpId ?? null,
          qty: single ? input.qty : undefined, createResolutionJob, note: input.note ?? null,
        });
        const codes = new Map(results.filter((r) => r.resolutionJobId).map((r) => [r.resolutionJobId as string, db.get<{ code: string }>(sql`SELECT code FROM jobs WHERE id = ${r.resolutionJobId}`)?.code ?? null] as const));
        return { succeeded: input.ids, failed: [], results: results.map((r) => ({ ...r, resolutionJobCode: r.resolutionJobId ? codes.get(r.resolutionJobId) ?? null : null })) };
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
  }),
});
