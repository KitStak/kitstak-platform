import { apiRoute } from '@/server/http/api';
import { getOutputSheet } from '@/server/domain/programs';
import { DomainError } from '@/server/errors';
import { dateParam } from '../../_lib';

/** GET /api/v1/programs/:key/output?date=&run= (log dialog). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => {
  const date = dateParam(searchParams.get('date'));
  if (!date) throw new DomainError('VALIDATION', 'Pick a date.', { date: 'Pick a date.' });
  return getOutputSheet(ctx, decodeURIComponent(params.key), date, { runId: searchParams.get('run') });
});
