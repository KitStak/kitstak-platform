import { apiRoute } from '@/server/http/api';
import { suggestAllStandards } from '@/server/domain';

/** A suggested target pace from history for every job type. */
export const GET = apiRoute(async ({ ctx }) => suggestAllStandards(ctx));
