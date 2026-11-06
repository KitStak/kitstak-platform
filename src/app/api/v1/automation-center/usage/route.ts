import { withApi } from '@/server/api';
import { getAutomationUsage } from '@/server/services/automations-center';
import { svc } from '../../_lib/route-helpers';

/** Every automation the caller can see across boards, with runs this month and the usage meter. */
export const GET = withApi({ permission: 'automation:read', rateLimit: 'default' }, (ctx) => getAutomationUsage(svc(ctx)));
