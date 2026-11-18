import { apiRoute } from '@/server/http/api';
import { getCalculatorSetup } from '@/server/domain';

/** Lists, rates and defaults the calculator form starts from. Needs money rights. */
export const GET = apiRoute(async ({ ctx }) => getCalculatorSetup(ctx));
