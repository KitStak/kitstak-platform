import { apiRoute } from '@/server/http/api';
import { getOrgCalendar } from '@/server/domain/programs';

/** GET /api/v1/calendar (the workspace calendar). */
export const GET = apiRoute(async ({ ctx }) => getOrgCalendar(ctx));
