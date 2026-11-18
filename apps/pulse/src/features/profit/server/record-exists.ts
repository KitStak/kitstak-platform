/**
 * Real 404s for client and extra service pages. The (app) layout calls this before any Suspense
 * boundary: once a loading boundary has started streaming, the status is already 200.
 */
import 'server-only';
import { getClient, getVasService, type DomainContext } from '@/server/domain';
import { isDomainError } from '@/server/errors';

const RESERVED = new Set(['by-link']);

/** True when `path` is `/clients/<id>` or `/services/<id>` and that record is not in this workspace. */
export async function profitRecordMissing(ctx: DomainContext, path: string): Promise<boolean> {
  const match = /^\/(clients|services)\/([^/?#]+)/.exec(path);
  if (!match) return false;
  let id = match[2] ?? '';
  try {
    id = decodeURIComponent(id);
  } catch {
    return true;
  }
  if (RESERVED.has(id)) return false;
  try {
    if (match[1] === 'clients') await getClient(ctx, id);
    else await getVasService(ctx, id);
    return false;
  } catch (error) {
    // Only "not found" is a 404. Anything else lets the page show its own message.
    return isDomainError(error) && error.code === 'NOT_FOUND';
  }
}
