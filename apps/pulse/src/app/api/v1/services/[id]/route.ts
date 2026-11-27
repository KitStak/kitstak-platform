import { apiRoute } from '@/server/http/api';
import { getVasService } from '@/server/domain';

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => getVasService(ctx, params.id));
