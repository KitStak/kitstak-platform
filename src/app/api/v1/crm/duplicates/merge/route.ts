import { withApi } from '@/server/api';
import { mergeDuplicatesSchema } from '@/server/services/crm-contracts';
import { mergeDuplicates } from '@/server/services/crm-duplicates';
import { svc } from '../../../_lib/route-helpers';

/** Merge duplicates into a primary record (duplicates go to Trash). */
export const POST = withApi(
  {
    permission: 'item:delete',
    body: mergeDuplicatesSchema,
    audit: {
      action: 'crm.records_merged',
      target: (ctx) => ({ type: 'item', id: (ctx.body as { primaryId: string }).primaryId }),
      metadata: (ctx) => ({ duplicateIds: (ctx.body as { duplicateIds: string[] }).duplicateIds }),
    },
  },
  (ctx) => mergeDuplicates(svc(ctx), ctx.body),
);
