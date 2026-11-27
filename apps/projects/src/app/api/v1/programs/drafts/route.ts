import { apiRoute } from '@/server/http/api';
import { listDrafts } from '@/server/domain/programs';

/** GET /api/v1/programs/drafts (the author's wizard drafts). */
export const GET = apiRoute(async ({ ctx }) => listDrafts(ctx));
