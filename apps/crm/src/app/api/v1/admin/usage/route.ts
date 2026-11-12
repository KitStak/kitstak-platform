import { withApi } from '@/server/api';
import { getUsage } from '@/server/services/admin-security';
import { svc } from '../../_lib/route-helpers';

export const GET = withApi({ permission: 'org:update' }, (ctx) => getUsage(svc(ctx)));
