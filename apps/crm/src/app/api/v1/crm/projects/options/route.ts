import { z } from 'zod';
import { withApi } from '@/server/api';
import { getProjectOptions } from '@/server/services/projects-bridge';
import { svc } from '../../../_lib/route-helpers';

/** Projects the caller can add tasks to (+ statuses) and the org's people, for the create-task dialog. */
export const GET = withApi(
  { permission: 'item:read', query: z.object({ q: z.string().max(200).optional() }) },
  (ctx) => getProjectOptions(svc(ctx), ctx.query.q),
);
