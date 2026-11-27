import { apiRoute } from '@/server/http/api';
import { floorToday, scheduleProgramSweep } from '@/server/domain/programs';
import { dateParam } from '../_lib';

/** GET /api/v1/programs/today?date= (Floor today). */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  scheduleProgramSweep(ctx);
  return floorToday(ctx, { date: dateParam(searchParams.get('date')) });
});
