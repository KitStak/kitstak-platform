import { apiRoute } from '@/server/http/api';
import { flag } from '@/server/http/params';
import { listVasServices } from '@/server/domain';

/** The extra services catalog. `?inactive=1` includes services that are turned off. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listVasServices(ctx, { includeInactive: flag(searchParams, 'inactive') }));
