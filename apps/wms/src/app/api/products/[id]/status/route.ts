/**
 * `POST /api/products/[id]/status` { status, version } — activate / deactivate one product. M09.
 * `version` (or an If-Match header) is required: missing → 409 VERSION_REQUIRED, stale → 409.
 * Bulk status (`/bulk/status`) acts on the current state of each id by design.
 */
import { z } from 'zod';
import { VERSION_REQUIRED_MESSAGE, expectedVersion } from '@/lib/grid-defs/products/concurrency';
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { domainCtx, idParamsSchema, versionSchema } from '@/server/repositories/platform-common';
import { setProductStatus } from '@/server/repositories/products-commands';

export const POST = defineRoute({
  permission: 'settings.products.edit',
  params: idParamsSchema,
  body: z.object({ status: z.enum(['Active', 'Inactive']), version: versionSchema.optional() }),
  handler: async ({ db, auth, actor, params, body, request }) => {
    const version = expectedVersion(body.version, request.headers.get('if-match'));
    if (version === null)
      throw new AppError('CONFLICT', VERSION_REQUIRED_MESSAGE, {
        fieldErrors: { version: ['Required'] },
        details: { reason: 'VERSION_REQUIRED' },
      });
    const row = await setProductStatus(
      db,
      { ...domainCtx(actor, auth), scope: auth.scope },
      params.id,
      body.status,
      version,
    );
    return { id: row.id, status: row.status, version: row.version };
  },
});
