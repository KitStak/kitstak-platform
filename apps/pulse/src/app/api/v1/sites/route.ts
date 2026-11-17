import { apiRoute } from '@/server/http/api';
import { listSites } from '@/server/domain';

export const GET = apiRoute(async ({ ctx }) => listSites(ctx));
