import { apiRoute } from '@/server/http/api';
import { searchTargets } from '@/server/integrations';
import { INTEGRATION_TARGET_TYPES, type IntegrationTargetType } from '@/lib/constants';
import { invalid } from '@/server/errors';

/** Link picker search: ?type=crm_item|crm_account|core_customer|wms_order|wms_work_order|wms_receipt|wms_count&q= */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const type = searchParams.get('type') as IntegrationTargetType | null;
  if (!type || !INTEGRATION_TARGET_TYPES.includes(type)) throw invalid('Unknown link type.');
  return searchTargets(ctx, type, searchParams.get('q') ?? '', 20);
});
