import { apiRoute } from '@/server/http/api';
import { listAutomations } from '@/server/domain';

/** Every rule the viewer can see (org-wide + per project). */
export const GET = apiRoute(async ({ ctx, searchParams }) => listAutomations(ctx, searchParams.get('projectId')));
