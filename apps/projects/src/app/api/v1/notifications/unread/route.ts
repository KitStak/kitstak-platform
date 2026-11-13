import { apiRoute } from '@/server/http/api';
import { unreadCount } from '@/server/domain';

export const GET = apiRoute(async ({ ctx }) => ({ count: await unreadCount(ctx) }), { cors: true });
