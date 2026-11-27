import { apiRoute } from '@/server/http/api';
import { requireProject } from '@/server/domain';
import { pulseProfit } from '@/server/integrations/pulse-profit';

/** KitStak Pulse job profit for the jobs linked to this project (Overview "Job profit" strip). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => {
  const { project } = await requireProject(ctx, /^[0-9a-f-]{36}$/i.test(params.key) ? { id: params.key } : { key: params.key });
  return pulseProfit(ctx, project);
});
