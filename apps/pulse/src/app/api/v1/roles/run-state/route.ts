import { apiRoute } from '@/server/http/api';
import { whoRunsPulse } from '@/server/domain';

/** `{ hasOwner, canClaim, ownerNames }` for "Run Pulse for this workspace". */
export const GET = apiRoute(async ({ ctx }) => whoRunsPulse(ctx));
