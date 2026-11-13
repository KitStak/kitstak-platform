import { apiRoute } from '@/server/http/api';
import { getRecordDetail } from '@/server/integrations/record-detail';
import { INTEGRATION_TARGET_TYPES, type IntegrationTargetType } from '@/lib/constants';
import { invalid, notFound } from '@/server/errors';

/** Live detail of a linked CRM / WMS record for chip hover cards: ?type=wms_receipt&id=… */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const type = searchParams.get('type') as IntegrationTargetType | null;
  const id = searchParams.get('id') ?? '';
  if (!type || !INTEGRATION_TARGET_TYPES.includes(type)) throw invalid('Unknown link type.');
  const detail = await getRecordDetail(ctx, type, id);
  if (!detail) throw notFound('This record');
  return detail;
});
