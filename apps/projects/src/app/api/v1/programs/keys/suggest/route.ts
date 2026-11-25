import { apiRoute } from '@/server/http/api';
import { suggestKey } from '@/server/domain';
import { takenKeys } from '@/server/domain/programs';

/** GET /api/v1/programs/keys/suggest?name= (wizard key hint). */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const name = (searchParams.get('name') ?? '').slice(0, 120);
  const [suggested, taken] = await Promise.all([suggestKey(ctx, name || 'Program'), takenKeys(ctx)]);
  return { suggested, taken };
});
