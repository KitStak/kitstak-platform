import { apiRoute } from '@/server/http/api';
import { getProgramRange } from '@/server/domain/programs';
import { DomainError } from '@/server/errors';
import { dateParam } from '../../_lib';

/** GET /api/v1/programs/:key/range?from=&to= (trend chart, at most 24 months). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => {
  const from = dateParam(searchParams.get('from'));
  const to = dateParam(searchParams.get('to'));
  if (!from || !to || from > to) throw new DomainError('VALIDATION', 'Pick a valid range.');
  return getProgramRange(ctx, decodeURIComponent(params.key), { from, to });
});
