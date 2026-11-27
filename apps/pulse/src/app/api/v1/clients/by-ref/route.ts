import { apiRoute } from '@/server/http/api';
import { uuidParam } from '@/server/http/params';
import { findClientByRef } from '@/server/domain';

/** Finds a client by Pulse id (`client`), `coreCustomerId` or `crmAccountItemId`. `null` when nothing matches. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  findClientByRef(ctx, { pulseClientId: uuidParam(searchParams, 'client'), coreCustomerId: uuidParam(searchParams, 'coreCustomerId'), crmAccountItemId: uuidParam(searchParams, 'crmAccountItemId') }),
);
