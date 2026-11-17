import { apiRoute } from '@/server/http/api';
import { getClient } from '@/server/domain';

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => getClient(ctx, params.id));
