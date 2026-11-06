import { withApi } from '@/server/api';
import { listAdminUsers } from '@/server/services/admin-users';
import { svc } from '../../_lib/route-helpers';

/** Directory for the admin center (status, last active, pending invitations). */
export const GET = withApi({ permission: 'member:update' }, (ctx) => listAdminUsers(svc(ctx)));
