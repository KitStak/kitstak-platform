import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { getProgramMonths } from '@/server/domain';

/** The By month tab (`ProgramMonthsDTO`), newest first. `?from=YYYY-MM&to=YYYY-MM` (the last 12 months by default, at most 36). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => getProgramMonths(ctx, decodeURIComponent(params.key), { from: str(searchParams, 'from'), to: str(searchParams, 'to') }));
