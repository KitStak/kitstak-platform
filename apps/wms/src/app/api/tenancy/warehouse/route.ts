/**
 * `POST /api/tenancy/warehouse` — set up the signed-in owner/admin's organization's own
 * warehouse (src/server/tenancy/provision.ts). Body: `{ orgId, warehouse: { name, code,
 * address…, contact… } }`. On success the new warehouse becomes the open one (org cookie).
 */
import { z } from 'zod';
import { getTenantDbFor } from '@/server/api/db';
import { fromZodError } from '@/server/api/errors';
import { provisionWarehouse } from '@/server/tenancy/provision';
import { tenancyRoute } from '@/server/tenancy/routes';
import { firstWarehouseSchema } from '@/server/tenancy/starter-seed';

/** Cloning ~120 tables + starter data takes a few seconds; leave generous headroom. */
export const maxDuration = 300;

const bodySchema = z.object({ orgId: z.uuid(), warehouse: firstWarehouseSchema });

export const POST = tenancyRoute('/api/tenancy/warehouse', async ({ platformDb, userId, body }) => {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw fromZodError(parsed.error);
  const result = await provisionWarehouse(
    platformDb,
    { tenantDb: getTenantDbFor },
    { orgId: parsed.data.orgId, userId, warehouse: parsed.data.warehouse },
  );
  return { data: { warehouseCode: result.warehouseCode }, orgId: parsed.data.orgId };
});
