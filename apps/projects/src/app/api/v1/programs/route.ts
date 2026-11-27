import { apiRoute, boolParam } from '@/server/http/api';
import { listPrograms, scheduleProgramSweep } from '@/server/domain/programs';
import { PROJECT_STATUSES, type ProjectStatus } from '@/lib/constants';
import { listParam } from './_lib';

/** GET /api/v1/programs?status=&customer=&q=&ids=&owner=&health=&archived=1 (directory, sidebar, palette). */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  scheduleProgramSweep(ctx);
  const status = listParam(searchParams.get('status'))?.filter((s): s is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(s));
  const health = listParam(searchParams.get('health'))?.filter((h): h is 'on_track' | 'at_risk' | 'off_track' => ['on_track', 'at_risk', 'off_track'].includes(h));
  return listPrograms(ctx, {
    status,
    customerId: searchParams.get('customer') ?? undefined,
    q: searchParams.get('q') ?? undefined,
    ids: listParam(searchParams.get('ids')),
    ownerId: searchParams.get('owner') ?? undefined,
    health,
    includeArchived: boolParam(searchParams.get('archived'), false),
  });
});
