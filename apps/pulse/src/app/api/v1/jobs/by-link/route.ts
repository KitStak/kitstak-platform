import { apiRoute } from '@/server/http/api';
import { oneOf, str } from '@/server/http/params';
import { findJobsByLink } from '@/server/domain';
import { invalid } from '@/server/errors';
import { LINK_TARGET_TYPES } from '@/lib/constants';

/** Jobs linked to a sibling record: `?type=crm_deal|crm_account|wms_work_order|wms_shipment_order|wms_client|pm_project|pm_task|core_customer&id=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const type = oneOf(searchParams, 'type', [...LINK_TARGET_TYPES, 'core_customer'] as const);
  const id = str(searchParams, 'id');
  if (!type || !id) throw invalid('A link lookup needs a type and an id.');
  return findJobsByLink(ctx, type, id);
});
