import { apiRoute } from '@/server/http/api';
import { getCloseChecklist } from '@/server/domain';

/** What closing `YYYY-MM` would check: things to fix, days not reviewed, the payroll gap. */
export const GET = apiRoute<{ month: string }>(async ({ ctx, params }) => getCloseChecklist(ctx, params.month));
