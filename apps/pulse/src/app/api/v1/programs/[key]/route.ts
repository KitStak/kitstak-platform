import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { getProgramMonth } from '@/server/domain';

/** The Overview of one program month (`ProgramMonthDTO`). `key` is the program key, any case. `?month=YYYY-MM`. */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => getProgramMonth(ctx, decodeURIComponent(params.key), str(searchParams, 'month')));
