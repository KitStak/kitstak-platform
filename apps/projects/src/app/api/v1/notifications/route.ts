import { apiRoute } from '@/server/http/api';
import { listNotifications, type InboxFilter } from '@/server/domain';

const FILTERS: readonly InboxFilter[] = ['all', 'unread', 'archived', 'mentions', 'assigned', 'comments', 'due'];

export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const filter = searchParams.get('filter') as InboxFilter | null;
  return listNotifications(ctx, {
    filter: filter && FILTERS.includes(filter) ? filter : 'all',
    before: searchParams.get('before') ?? undefined,
  });
});
