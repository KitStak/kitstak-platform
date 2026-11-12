/**
 * `GET /api/jobs/assignees?warehouseId=&q=` — users eligible for job / task Assign (critic R4):
 * active, non-client, non-API users linked to the warehouse who can execute tasks. Queries
 * shorter than 3 characters return no rows (Logiwa's 3-character minimum).
 * Returns the picker contract `[{ id, label, description }]`.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { forbiddenError } from '@/server/api/errors';
import { hasWarehouse } from '@/server/auth/scope';
import { searchAssignees } from '@/server/repositories/wave-rules-options';

export const GET = defineRoute({
  permission: ['fulfillment.job_management.assign', 'fulfillment.task_details.update_task'],
  query: z.object({
    warehouseId: z.string().trim().min(1).max(64),
    q: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
  handler: async ({ db, auth, query }) => {
    if (!hasWarehouse(auth.scope, query.warehouseId)) throw forbiddenError();
    return await searchAssignees(db, query.warehouseId, query.q ?? '', query.limit ?? 50);
  },
});
