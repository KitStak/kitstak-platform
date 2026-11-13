import { z } from 'zod';
import { withApi } from '@/server/api';
import { createItemTask, getItemProjects } from '@/server/services/projects-bridge';
import { created, svc, uuidParams } from '../../../../_lib/route-helpers';

const params = uuidParams('itemId');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a real date');

const createTaskSchema = z
  .object({
    projectId: z.uuid('Pick a project'),
    title: z
      .string()
      .trim()
      .min(1, 'Give the task a name')
      .max(500, 'Task names can be up to 500 characters'),
    description: z.string().max(20_000).nullish(),
    statusId: z.uuid().nullish(),
    priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
    assigneeId: z.uuid().nullish(),
    dueDate: isoDate.nullish(),
  })
  .strict();

/** KitStak Projects work linked to this record (projects with progress, tasks with status). */
export const GET = withApi({ permission: 'item:read', params }, (ctx) =>
  getItemProjects(svc(ctx), ctx.params.itemId),
);

/** Create a task in a Projects project, linked to this record. */
export const POST = withApi({ permission: 'item:read', params, body: createTaskSchema }, async (ctx) =>
  created(await createItemTask(svc(ctx), ctx.params.itemId, ctx.body)),
);
