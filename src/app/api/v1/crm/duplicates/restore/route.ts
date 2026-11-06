import { withApi } from '@/server/api';
import { restoreMergedSchema } from '@/server/services/crm-contracts';
import { restoreMerged } from '@/server/services/crm-duplicates';
import { svc } from '../../../_lib/route-helpers';

/** Undo a merge: restore the trashed duplicates and (with primaryId) revert the merged fields and links. */
export const POST = withApi({ permission: 'item:delete', body: restoreMergedSchema }, (ctx) =>
  restoreMerged(svc(ctx), ctx.body),
);
