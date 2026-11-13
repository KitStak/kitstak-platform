import { apiRoute } from '@/server/http/api';
import { getProjectDetail } from '@/server/domain';

/** `[key]` is the project key (OPS) or id. */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => getProjectDetail(ctx, projectRef(params.key)));

function projectRef(value: string): { key: string } | { id: string } {
  return /^[0-9a-f-]{36}$/i.test(value) ? { id: value } : { key: value };
}
