import { apiRoute } from '@/server/http/api';
import { otherPricesForCustomer } from '@/server/domain/programs';

/** GET /api/v1/programs/:key/other-prices (read only). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => otherPricesForCustomer(ctx, decodeURIComponent(params.key)));
