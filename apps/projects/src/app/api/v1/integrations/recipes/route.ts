import { apiRoute } from '@/server/http/api';
import { listRecordTriggers } from '@/server/integrations/record-triggers';

/** Cross-app recipes of the workspace with their latest runs (Automations page). */
export const GET = apiRoute(async ({ ctx }) => listRecordTriggers(ctx));
