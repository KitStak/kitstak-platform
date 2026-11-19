import { apiRoute } from '@/server/http/api';
import { flag, str } from '@/server/http/params';
import { listClients } from '@/server/domain';

/** `?q=&active=1&deleted=1`. Each client carries `jobCount` and `openJobCount`. `deleted=1` needs the right to manage jobs and clients (403 without it). */
export const GET = apiRoute(async ({ ctx, searchParams }) => listClients(ctx, { q: str(searchParams, 'q'), includeInactive: !flag(searchParams, 'active'), includeDeleted: flag(searchParams, 'deleted') }));
