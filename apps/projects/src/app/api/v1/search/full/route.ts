import { apiRoute } from '@/server/http/api';
import { searchFull } from '@/server/domain';
import type { FullSearchType } from '@/lib/types';

const TYPES: readonly FullSearchType[] = ['all', 'tasks', 'projects', 'comments', 'people', 'goals'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/v1/search/full?q&type&project&status=open|done&assignee=me|none|<id>&limit */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const type = searchParams.get('type') as FullSearchType | null;
  const status = searchParams.get('status');
  const assignee = searchParams.get('assignee');
  const project = searchParams.get('project');
  const limit = Number(searchParams.get('limit'));
  return searchFull(ctx, searchParams.get('q') ?? '', {
    type: type && TYPES.includes(type) ? type : 'all',
    projectId: project && UUID.test(project) ? project : null,
    status: status === 'open' || status === 'done' ? status : 'any',
    assignee: assignee === 'me' || assignee === 'none' || (assignee && UUID.test(assignee)) ? assignee : null,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  });
});
