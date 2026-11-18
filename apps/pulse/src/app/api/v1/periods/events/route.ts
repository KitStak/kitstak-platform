import { apiRoute } from '@/server/http/api';
import { listCloseEvents } from '@/server/domain';

/** Who closed and reopened which month, and why. Newest first. */
export const GET = apiRoute(async ({ ctx }) => listCloseEvents(ctx));
