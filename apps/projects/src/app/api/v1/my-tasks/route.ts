import { apiRoute } from '@/server/http/api';
import { listMyTasks, type MyTasksScope } from '@/server/domain';

const SCOPES: readonly MyTasksScope[] = ['assigned', 'created', 'watching', 'all'];

/** ?scope=assigned|created|watching|all&completed=0|1 (default: open + done in the last 7 days). */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const scope = searchParams.get('scope') as MyTasksScope | null;
  const completed = searchParams.get('completed');
  return listMyTasks(ctx, {
    scope: scope && SCOPES.includes(scope) ? scope : 'assigned',
    includeCompleted: completed === null ? undefined : completed === '1',
  });
});
