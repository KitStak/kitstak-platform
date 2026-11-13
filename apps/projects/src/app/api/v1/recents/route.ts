import { apiRoute } from '@/server/http/api';
import { listRecents } from '@/server/domain';

export const GET = apiRoute(async ({ ctx }) => listRecents(ctx));
