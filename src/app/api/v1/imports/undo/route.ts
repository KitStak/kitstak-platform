/** POST → undo a whole import by batch id (archives created items, reverts updates). */
import { withApi } from '@/server/api';
import { importUndoSchema } from '@/server/services/import-export-contracts';
import { undoImport } from '@/server/services/import-export-import';
import { svc } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

export const POST = withApi(
  { permission: 'data:import', rateLimit: 'mutation', rateLimitCost: 5, body: importUndoSchema },
  async (ctx) => undoImport(svc(ctx), ctx.body),
);
