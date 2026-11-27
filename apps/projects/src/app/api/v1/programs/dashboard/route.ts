import { apiRoute } from '@/server/http/api';
import { dashboardPrograms } from '@/server/domain/programs';

/** GET /api/v1/programs/dashboard (the three dashboard panels). */
export const GET = apiRoute(async ({ ctx }) => dashboardPrograms(ctx));
