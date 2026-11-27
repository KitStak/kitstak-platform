import { apiRoute } from '@/server/http/api';
import { wizardPrefill } from '@/server/domain/programs';

/** GET /api/v1/programs/prefill?crmItem=&template=&copy=&customer= */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  wizardPrefill(ctx, {
    crmItemId: searchParams.get('crmItem') ?? undefined,
    templateId: searchParams.get('template') ?? undefined,
    copyKey: searchParams.get('copy') ?? undefined,
    customerId: searchParams.get('customer') ?? undefined,
  }),
);
