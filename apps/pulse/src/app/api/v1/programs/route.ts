import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { listTrackedPrograms } from '@/server/domain';

/**
 * The Programs list (`ProgramListDTO`): one row per tracked program with this month's numbers,
 * plan, forecast and health, plus "Not tracked yet". `?month=YYYY-MM` (this month by default).
 * `available: false` with a `reason` when Projects is not entitled or its program tables are missing.
 */
export const GET = apiRoute(async ({ ctx, searchParams }) => listTrackedPrograms(ctx, { month: str(searchParams, 'month') }));
