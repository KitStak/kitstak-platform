import { apiRoute } from '@/server/http/api';
import { listNotifications, type InboxFilter } from '@/server/domain';
import { scheduleProgramSweep } from '@/server/domain/programs';

const FILTERS: readonly InboxFilter[] = ['all', 'unread', 'archived', 'mentions', 'assigned', 'comments', 'due'];

export const GET = apiRoute(async ({ ctx, searchParams }) => {
  scheduleProgramSweep(ctx);
  const filter = searchParams.get('filter') as InboxFilter | null;
  return listNotifications(ctx, {
    filter: filter && FILTERS.includes(filter) ? filter : 'all',
    before: searchParams.get('before') ?? undefined,
  });
});
