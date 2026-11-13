import { apiRoute } from '@/server/http/api';
import { customerPulse } from '@/server/integrations/customer-pulse';

/** Home "Your customers today": per-customer CRM + WMS picture and cross-app mismatches. */
export const GET = apiRoute(async ({ ctx }) => customerPulse(ctx));
