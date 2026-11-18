import { apiRoute } from '@/server/http/api';
import { intParam, oneOf, str } from '@/server/http/params';
import { requirePulse } from '@/server/domain';
import { invalid } from '@/server/errors';
import { searchRecords } from '@/server/integrations';
import { LINKABLE_TYPES } from '@/features/integrations/types';

/** Records a job can be linked to: `?type=crm_deal|wms_work_order|pm_project&q=`. Empty when that app cannot be read. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  await requirePulse(ctx, 'job:manage');
  const type = oneOf(searchParams, 'type', LINKABLE_TYPES);
  if (!type) throw invalid('Pick what to search: a CRM deal, a work order or a project.');
  return searchRecords(ctx, type, str(searchParams, 'q') ?? '', intParam(searchParams, 'limit', 12, 50));
});
