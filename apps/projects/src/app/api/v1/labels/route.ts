import { apiRoute } from '@/server/http/api';
import { listLabels } from '@/server/domain';

/** Workspace-wide labels, or a project's usable labels with ?projectId=. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listLabels(ctx, searchParams.get('projectId')));
