import { apiRoute } from '@/server/http/api';
import { getCloseDetail } from '@/server/domain';

/** The close checklist of `YYYY-MM` as steps, with what a close will lock. */
export const GET = apiRoute<{ month: string }>(async ({ ctx, params }) => getCloseDetail(ctx, params.month));
