import { apiRoute } from '@/server/http/api';
import { listFormSubmissions } from '@/server/domain';

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => listFormSubmissions(ctx, params.id));
