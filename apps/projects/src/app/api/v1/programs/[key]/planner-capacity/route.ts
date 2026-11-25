import { apiRoute } from '@/server/http/api';
import { plannerCapacity } from '@/server/domain/programs';
import { DomainError } from '@/server/errors';
import { dateParam } from '../../_lib';

/** GET /api/v1/programs/:key/planner-capacity?from=&to= (WMS read only). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => {
  const from = dateParam(searchParams.get('from'));
  const to = dateParam(searchParams.get('to'));
  if (!from || !to) throw new DomainError('VALIDATION', 'Pick a range.');
  return plannerCapacity(ctx, decodeURIComponent(params.key), { from, to });
});
