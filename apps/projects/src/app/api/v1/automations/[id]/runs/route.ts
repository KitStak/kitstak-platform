import { apiRoute } from '@/server/http/api';
import { listAutomationRuns } from '@/server/domain';

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => listAutomationRuns(ctx, params.id));
