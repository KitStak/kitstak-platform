import { apiRoute } from '@/server/http/api';
import { listTemplates } from '@/server/domain';

export const GET = apiRoute(async ({ ctx }) => listTemplates(ctx));
