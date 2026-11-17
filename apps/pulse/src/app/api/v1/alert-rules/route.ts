import { apiRoute } from '@/server/http/api';
import { listAlertRules } from '@/server/domain';

export const GET = apiRoute(async ({ ctx }) => listAlertRules(ctx));
