import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { getGoalsBoard } from '@/server/domain';

/** Goals against actuals for one month, with pace and a six month trend. `?month=YYYY-MM`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => getGoalsBoard(ctx, { month: str(searchParams, 'month') }));
