import { apiRoute } from '@/server/http/api';
import { listForms } from '@/server/domain';

export const GET = apiRoute(async ({ ctx, searchParams }) => listForms(ctx, searchParams.get('projectId') ?? undefined));
