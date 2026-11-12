/**
 * `GET /api/products/[id]` (detail, or `?view=form` for the edit / duplicate wizard) · `PATCH`
 * (wizard edit; partial bodies are merged over the stored product). M09.
 * PATCH requires the loaded `version` (body) or an `If-Match` header: missing → 409
 * VERSION_REQUIRED, stale → 409 CONFLICT.
 */
import { z } from 'zod';
import { PRODUCT_READ_PERMISSIONS } from '@/lib/grid-defs/products/permissions';
import { VERSION_REQUIRED_MESSAGE, expectedVersion } from '@/lib/grid-defs/products/concurrency';
import { defineRoute } from '@/server/api/define-route';
import { AppError, notFoundError } from '@/server/api/errors';
import { requirePermission } from '@/server/auth/permissions';
import { domainCtx, idParamsSchema } from '@/server/repositories/platform-common';
import { updateProductFromWizard } from '@/server/repositories/products-commands';
import { getProductDetail, getProductForm } from '@/server/repositories/products-detail';
import type { ProductInput } from '@/lib/grid-defs/products/product-form';

export const GET = defineRoute({
  permission: PRODUCT_READ_PERMISSIONS,
  params: idParamsSchema,
  query: z.object({ view: z.enum(['detail', 'form']).default('detail') }),
  handler: async ({ db, auth, params, query }) => {
    // The form payload feeds Edit / Duplicate only.
    if (query.view === 'form')
      requirePermission(auth, ['settings.products.edit', 'settings.products.create']);
    const data =
      query.view === 'form'
        ? await getProductForm(db, auth.scope, params.id)
        : await getProductDetail(db, auth.scope, auth.viewScope, params.id);
    if (!data) throw notFoundError('Product');
    return data;
  },
});

export const PATCH = defineRoute({
  permission: 'settings.products.edit',
  params: idParamsSchema,
  body: z.record(z.string(), z.unknown()),
  handler: async ({ db, auth, actor, params, body, request }) => {
    const version = expectedVersion(body.version, request.headers.get('if-match'));
    if (version === null)
      throw new AppError('CONFLICT', VERSION_REQUIRED_MESSAGE, {
        fieldErrors: { version: ['Required'] },
        details: { reason: 'VERSION_REQUIRED' },
      });
    const row = await updateProductFromWizard(
      db,
      { ...domainCtx(actor, auth), scope: auth.scope },
      params.id,
      { ...body, version } as ProductInput,
    );
    return { id: row.id, sku: row.sku, version: row.version };
  },
});
