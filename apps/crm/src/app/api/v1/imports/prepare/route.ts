/** POST → create the destination board/group/columns/labels for an import. */
import { withApi } from '@/server/api';
import { prepareImportSchema } from '@/server/services/import-export-contracts';
import { prepareImport } from '@/server/services/import-export-import';
import { svc } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

export const POST = withApi(
  { permission: 'data:import', rateLimit: 'mutation', rateLimitCost: 2, body: prepareImportSchema, maxBodyBytes: 2 * 1024 * 1024 },
  async (ctx) => prepareImport(svc(ctx), ctx.body),
);
