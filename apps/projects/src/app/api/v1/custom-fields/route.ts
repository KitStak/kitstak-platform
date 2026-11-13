import { apiRoute } from '@/server/http/api';
import { listCustomFields } from '@/server/domain';

export const GET = apiRoute(async ({ ctx, searchParams }) => listCustomFields(ctx, searchParams.get('projectId')));
