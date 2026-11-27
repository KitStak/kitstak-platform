import { apiRoute } from '@/server/http/api';
import { getQuoteScenario } from '@/server/domain';

/** One saved scenario. */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => getQuoteScenario(ctx, params.id));
