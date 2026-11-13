import { z } from 'zod';
import { withApi } from '@/server/api';
import { linkItemProject } from '@/server/services/projects-bridge';
import { created, svc, uuidParams } from '../../../../../_lib/route-helpers';

const params = uuidParams('itemId');

/** Link an existing Projects project to this record. */
export const POST = withApi(
  { permission: 'item:read', params, body: z.object({ projectId: z.uuid('Pick a project') }).strict() },
  async (ctx) => created(await linkItemProject(svc(ctx), ctx.params.itemId, ctx.body.projectId)),
);
