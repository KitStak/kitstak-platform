import { getSampleState } from '@/server/domain';
import { apiRoute } from '@/server/http/api';

/** `GET /api/v1/import/sample`: whether the made up shop is loaded, and how much of it. */
export const GET = apiRoute(async ({ ctx }) => getSampleState(ctx));
