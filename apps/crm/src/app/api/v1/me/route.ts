import { withApi } from '@/server/api';
import { getMe } from '@/server/services/org';

/** Current user profile, organization memberships and unread notification total. */
export const GET = withApi({ org: 'none' }, (ctx) => getMe(ctx.db, ctx.user.id));
