import { apiRoute } from '@/server/http/api';
import { countTrackedPrograms } from '@/server/domain';

/** `{ count }`: how many programs are tracked in Pulse, for the Jobs list footer. */
export const GET = apiRoute(async ({ ctx }) => ({ count: await countTrackedPrograms(ctx) }));
