import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { getProgramDays } from '@/server/domain';

/** The Days tab (`ProgramDaysDTO`): every work day of the month. `?month=YYYY-MM`. */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => getProgramDays(ctx, decodeURIComponent(params.key), str(searchParams, 'month')));
