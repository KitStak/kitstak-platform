import { apiRoute } from '@/server/http/api';
import { listPeriods } from '@/server/domain';

/** Every month with data, newest first, open or closed. */
export const GET = apiRoute(async ({ ctx }) => listPeriods(ctx));
