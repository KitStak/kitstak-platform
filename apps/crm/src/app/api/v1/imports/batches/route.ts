/** POST → import one batch of rows (one transaction; per-row savepoints). */
import { withApi } from '@/server/api';
import { importBatchSchema } from '@/server/services/import-export-contracts';
import { runImportBatch } from '@/server/services/import-export-batch';
import { svc } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

export const POST = withApi(
  { permission: 'data:import', rateLimit: 'mutation', rateLimitCost: 2, body: importBatchSchema, maxBodyBytes: 4 * 1024 * 1024 },
  async (ctx) => runImportBatch(svc(ctx), ctx.body),
);
