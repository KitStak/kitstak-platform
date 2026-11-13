import { apiRoute, boolParam } from '@/server/http/api';
import { listProjects } from '@/server/domain';

/** ?space=<id|none>&archived=1&q=text */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const space = searchParams.get('space');
  return listProjects(ctx, {
    spaceId: space === null ? undefined : space === 'none' ? null : space,
    includeArchived: boolParam(searchParams.get('archived'), false),
    search: searchParams.get('q') ?? undefined,
  });
});
