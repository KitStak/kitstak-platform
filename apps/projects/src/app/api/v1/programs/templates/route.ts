import { apiRoute } from '@/server/http/api';
import { listProgramTemplates } from '@/server/domain/programs';

/** GET /api/v1/programs/templates (wizard gallery). */
export const GET = apiRoute(async ({ ctx }) => listProgramTemplates(ctx));
