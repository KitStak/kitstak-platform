import { apiRoute } from '@/server/http/api';
import { listCycles } from '@/server/domain';

/** Cycles of a project (closes ended ones first: unfinished work rolls to the next cycle). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) =>
  listCycles(ctx, /^[0-9a-f-]{36}$/i.test(params.key) ? { id: params.key } : { key: params.key }),
);
