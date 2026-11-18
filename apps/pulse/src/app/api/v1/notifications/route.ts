import { apiRoute } from '@/server/http/api';
import { flag, intParam } from '@/server/http/params';
import { listNotifications } from '@/server/domain';

/** The caller's notifications, newest first, worded for them. `?unread=1&limit=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listNotifications(ctx, { unreadOnly: flag(searchParams, 'unread'), limit: intParam(searchParams, 'limit', 50, 200) }));
