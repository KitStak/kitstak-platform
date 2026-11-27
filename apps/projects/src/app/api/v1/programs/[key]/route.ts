import { apiRoute } from '@/server/http/api';
import { getProgramDetail, scheduleProgramSweep } from '@/server/domain/programs';

/** GET /api/v1/programs/:key */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => {
  scheduleProgramSweep(ctx);
  return getProgramDetail(ctx, decodeURIComponent(params.key));
});
