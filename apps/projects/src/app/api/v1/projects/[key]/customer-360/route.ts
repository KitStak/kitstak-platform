import { apiRoute } from '@/server/http/api';
import { requireProject } from '@/server/domain';
import { customer360 } from '@/server/integrations/customer360';

/** Live CRM + WMS picture of the customer this project serves (Overview "Customer 360" strip). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => {
  const { project } = await requireProject(ctx, /^[0-9a-f-]{36}$/i.test(params.key) ? { id: params.key } : { key: params.key });
  return customer360(ctx, project);
});
