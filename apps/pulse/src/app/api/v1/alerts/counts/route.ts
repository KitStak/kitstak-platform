import { apiRoute } from '@/server/http/api';
import { countAlertsByStatus } from '@/server/domain';

/** How many alerts sit in each inbox tab, plus how many open ones are assigned to you. */
export const GET = apiRoute(async ({ ctx }) => countAlertsByStatus(ctx));
