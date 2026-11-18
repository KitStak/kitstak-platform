import { apiRoute } from '@/server/http/api';
import { getBadges } from '@/server/domain';

/** `{ jobsAtRisk, openAlerts, unreadNotifications }` for the sidebar and the bell. */
export const GET = apiRoute(async ({ ctx }) => getBadges(ctx));
