import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { getProgramVariants } from '@/server/domain';

/** The By variant tab (`ProgramVariantsDTO`). `?month=YYYY-MM`. */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => getProgramVariants(ctx, decodeURIComponent(params.key), str(searchParams, 'month')));
