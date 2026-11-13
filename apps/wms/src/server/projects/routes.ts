/**
 * Route factories for the "Project tasks" panel, shared by `/api/orders/:id/project-tasks`
 * and `/api/work-orders/:id/project-tasks` (each passes its own view permission).
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import {
  createRecordTask,
  getRecordProjects,
  unlinkRecordWork,
  wmsOrigin,
  type WmsRecordType,
} from './bridge';

const params = z.object({ id: z.string().trim().min(1).max(64) });
const linkParams = params.extend({ linkId: z.uuid() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a real date');

export const createTaskBodySchema = z
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

export function projectTasksRoutes(type: WmsRecordType, permission: string) {
  return {
    GET: defineRoute({
      permission,
      params,
      handler: async ({ db, auth, params: p, request }) =>
        await getRecordProjects(db, auth, type, p.id, wmsOrigin(request)),
    }),
    POST: defineRoute({
      permission,
      params,
      body: createTaskBodySchema,
      handler: async ({ db, auth, params: p, body, request }) =>
        await createRecordTask(db, auth, type, p.id, wmsOrigin(request), body),
    }),
  };
}

export function projectLinkRoutes(type: WmsRecordType, permission: string) {
  return {
    DELETE: defineRoute({
      permission,
      params: linkParams,
      handler: async ({ db, auth, params: p, request }) => {
        await unlinkRecordWork(db, auth, type, p.id, wmsOrigin(request), p.linkId);
        return { removed: true };
      },
    }),
  };
}
