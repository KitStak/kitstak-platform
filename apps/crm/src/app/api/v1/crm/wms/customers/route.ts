import { withApi } from '@/server/api';
import { searchCoreCustomers } from '@/server/services/wms-link';
import { coreCustomersQuerySchema } from '@/server/services/wms-link-contracts';
import { svc } from '../../../_lib/route-helpers';

/** Core customers (shared WMS client registry) in the org, searchable by name/code. */
export const GET = withApi({ permission: 'item:read', query: coreCustomersQuerySchema }, (ctx) =>
  searchCoreCustomers(svc(ctx), ctx.query),
);
