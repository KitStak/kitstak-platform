/**
 * `POST /api/tenancy/switch` — open another of the user's organizations' warehouses.
 * Body: `{ orgId }`. Only orgs the user is a member of, that hold WMS, have a warehouse and
 * give the user access in it are accepted (non-matches answer NOT_FOUND, so org ids cannot be probed).
 */
import { z } from 'zod';
import { AppError, fromZodError } from '@/server/api/errors';
import { accessibleWmsOrgs } from '@/server/auth/session-store';
import { tenancyRoute } from '@/server/tenancy/routes';

const bodySchema = z.object({ orgId: z.uuid() });

export const POST = tenancyRoute('/api/tenancy/switch', async ({ platformDb, userId, body }) => {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw fromZodError(parsed.error);
  const target = (await accessibleWmsOrgs(platformDb, userId)).find((o) => o.orgId === parsed.data.orgId);
  if (!target) throw new AppError('NOT_FOUND', 'Warehouse not found');
  return { data: { orgId: target.orgId, name: target.name }, orgId: target.orgId };
});
