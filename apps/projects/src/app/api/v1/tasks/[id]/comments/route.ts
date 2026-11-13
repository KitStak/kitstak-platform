import { apiRoute } from '@/server/http/api';
import { listComments } from '@/server/domain';

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => listComments(ctx, params.id));
