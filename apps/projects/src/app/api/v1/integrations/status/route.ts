import { apiRoute } from '@/server/http/api';
import { availableTargetTypes, integrationAvailability } from '@/server/integrations';

/** Which sibling apps are connected for this org, and which link types the UI may offer. */
export const GET = apiRoute(async ({ ctx }) => ({ ...(await integrationAvailability(ctx)), targetTypes: await availableTargetTypes(ctx) }));
