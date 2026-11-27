import { apiRoute } from '@/server/http/api';
import { getUserPrefs } from '@/server/domain';

/** The caller's preferences for this org. */
export const GET = apiRoute(async ({ ctx }) => getUserPrefs(ctx));
