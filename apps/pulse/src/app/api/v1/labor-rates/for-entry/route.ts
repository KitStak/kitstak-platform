import { apiRoute } from '@/server/http/api';
import { dateParam, uuidParam } from '@/server/http/params';
import { rateForEntry, resolveSite } from '@/server/domain';

/** The rate that applies to an entry: `?laborClass=&site=&date=`. Says where it came from (`class`, `default`, `none`). */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const site = await resolveSite(ctx, uuidParam(searchParams, 'site'));
  return rateForEntry(ctx, { laborClassId: uuidParam(searchParams, 'laborClass'), siteId: site.id, workDate: dateParam(searchParams, 'date') ?? new Date().toISOString().slice(0, 10) });
});
