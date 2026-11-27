import { apiRoute } from '@/server/http/api';
import { getCloseBoard } from '@/server/domain';

/** Every month with data, open or closed, with its totals and who closed it. */
export const GET = apiRoute(async ({ ctx }) => getCloseBoard(ctx));
