import { getOnboardingState } from '@/server/domain/sample';
import { apiRoute } from '@/server/http/api';

/** `GET /api/v1/import/onboarding`: the five getting started steps, judged from real data, and the first profit number. */
export const GET = apiRoute(async ({ ctx }) => getOnboardingState(ctx));
