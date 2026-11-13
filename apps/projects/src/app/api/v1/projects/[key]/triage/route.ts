import { apiRoute } from '@/server/http/api';
import { listTriage, type TriageFilter } from '@/server/domain';

const FILTERS: readonly TriageFilter[] = ['open', 'snoozed', 'decided'];

/** Triage queue: `?filter=open|snoozed|decided`. */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => {
  const raw = searchParams.get('filter') ?? 'open';
  const filter = (FILTERS as readonly string[]).includes(raw) ? (raw as TriageFilter) : 'open';
  return listTriage(ctx, /^[0-9a-f-]{36}$/i.test(params.key) ? { id: params.key } : { key: params.key }, filter);
});
