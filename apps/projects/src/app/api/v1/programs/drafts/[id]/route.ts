import { apiRoute } from '@/server/http/api';
import { getDraft } from '@/server/domain/programs';

/** GET /api/v1/programs/drafts/:id */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => getDraft(ctx, params.id));
