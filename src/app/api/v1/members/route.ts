import { withApi } from '@/server/api';
import { listMembers } from '@/server/services/members';
import { svc } from '../_lib/route-helpers';

export const GET = withApi({ permission: 'member:read' }, (ctx) => listMembers(svc(ctx)));
