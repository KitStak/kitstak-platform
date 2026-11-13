import 'server-only';
import { resolveTaskKey } from '@/server/domain';
import type { DomainContext } from '@/server/domain/_shared';
import { parseTaskKey } from '@/lib/task-key';
import { notFound } from '@/server/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the `[id]` segment of `/api/v1/tasks/[id]/*` to a task uuid. Accepts a uuid or a task key
 * (OPS-42, case-insensitive). Anything else is a 404, never a database error.
 */
export async function resolveTaskParam(ctx: DomainContext, raw: string): Promise<string> {
  const value = decodeURIComponent(raw).trim();
  if (UUID.test(value)) return value;
  const ref = parseTaskKey(value);
  if (!ref) throw notFound('That task');
  return resolveTaskKey(ctx, ref.projectKey, ref.number);
}
