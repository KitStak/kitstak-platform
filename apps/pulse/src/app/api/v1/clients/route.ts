import { apiRoute } from '@/server/http/api';
import { flag, str } from '@/server/http/params';
import { listClients } from '@/server/domain';

/** `?q=&active=1&deleted=1`. Each client carries `jobCount` and `openJobCount`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listClients(ctx, { q: str(searchParams, 'q'), includeInactive: !flag(searchParams, 'active'), includeDeleted: flag(searchParams, 'deleted') }));
