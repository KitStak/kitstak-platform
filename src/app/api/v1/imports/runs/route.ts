/** GET ?batchId= → summary of a past import (for the /import?run= deep link and its Undo). */
import { withApi } from '@/server/api';
import { BadRequestError } from '@/server/http/errors';
import { importRunQuerySchema } from '@/server/services/import-export-contracts';
import { getImportRun } from '@/server/services/import-export-import';
import { svc } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

export const GET = withApi({ permission: 'data:import', rateLimit: 'default' }, async (ctx) => {
  const parsed = importRunQuerySchema.safeParse({ batchId: new URL(ctx.request.url).searchParams.get('batchId') });
  if (!parsed.success) throw new BadRequestError('A valid batchId is required');
  return getImportRun(svc(ctx), parsed.data.batchId);
});
