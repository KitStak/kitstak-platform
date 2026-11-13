import { z } from 'zod';
import { apiRoute, corsPreflight, readJson } from '@/server/http/api';
import { addLink, createTask, requireProject } from '@/server/domain';
import { INTEGRATION_TARGET_TYPES, PRIORITIES } from '@/lib/constants';

const body = z.object({
  /** Project id or key. */
  project: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(200_000).nullable().optional(),
  statusId: z.uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  labelIds: z.array(z.uuid()).max(50).optional(),
  /** Link the new task to a CRM/WMS record in the same step. */
  link: z.object({ targetType: z.enum(INTEGRATION_TARGET_TYPES), targetId: z.string().min(1).max(100) }).optional(),
});

export const OPTIONS = corsPreflight();

/**
 * Create a task (used by CRM/WMS "Create task" buttons and the Projects UI). Same-org only:
 * the project must belong to the caller's active org. Returns the TaskSummary (+ link).
 */
export const POST = apiRoute(
  async ({ ctx, request }) => {
    const parsed = body.parse(await readJson(request));
    const { project } = await requireProject(ctx, /^[0-9a-f-]{36}$/i.test(parsed.project) ? { id: parsed.project } : { key: parsed.project }, 'task:create');
    const task = await createTask(ctx, { ...parsed, projectId: project.id });
    const link = parsed.link ? await addLink(ctx, { taskId: task.id, targetType: parsed.link.targetType, targetId: parsed.link.targetId }) : null;
    return { task, link, url: `/p/${project.key}/${task.number}` };
  },
  { cors: true },
);
