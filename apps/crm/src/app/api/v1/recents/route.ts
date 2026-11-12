import { z } from 'zod';
import { withApi } from '@/server/api';
import { entityRefSchema, listRecents, recordVisit } from '@/server/services/personal';
import { svc } from '../_lib/route-helpers';

export const GET = withApi(
  { permission: 'org:read', query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }) },
  (ctx) => listRecents(svc(ctx), ctx.query.limit),
);

export const POST = withApi({ permission: 'org:read', rateLimit: 'default', body: entityRefSchema }, (ctx) =>
  recordVisit(svc(ctx), ctx.body),
);
