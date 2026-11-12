/** POST → finish an import (completion notification + one audit row, rebuilt server-side). */
import { withApi } from '@/server/api';
import { importCompleteSchema } from '@/server/services/import-export-contracts';
import { completeImport } from '@/server/services/import-export-import';
import { svc } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

export const POST = withApi(
  { permission: 'data:import', rateLimit: 'mutation', body: importCompleteSchema },
  async (ctx) => completeImport(svc(ctx), ctx.body),
);
