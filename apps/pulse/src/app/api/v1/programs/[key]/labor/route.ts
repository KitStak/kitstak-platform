import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { getProgramLabor } from '@/server/domain';

/** The Labor tab (`ProgramLaborDTO`): hours and cost by labor class and by person. `?month=YYYY-MM`. */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => getProgramLabor(ctx, decodeURIComponent(params.key), str(searchParams, 'month')));
