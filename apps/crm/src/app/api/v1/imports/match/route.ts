/** POST → which dedupe keys already exist on the board. */
import { withApi } from '@/server/api';
import { importMatchSchema } from '@/server/services/import-export-contracts';
import { matchImportKeys } from '@/server/services/import-export-batch';
import { svc } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

export const POST = withApi(
  { permission: 'data:import', rateLimit: 'mutation', body: importMatchSchema, maxBodyBytes: 4 * 1024 * 1024 },
  async (ctx) => matchImportKeys(svc(ctx), ctx.body),
);
