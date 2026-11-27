import { apiRoute } from '@/server/http/api';
import { getSettings } from '@/server/domain';

export const GET = apiRoute(async ({ ctx }) => getSettings(ctx));
