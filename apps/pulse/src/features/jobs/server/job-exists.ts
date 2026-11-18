/**
 * Real 404 for a job that does not exist. The signed in layout calls this before any Suspense
 * boundary, because a page that already started streaming can no longer change its status.
 */
import 'server-only';
import { getJobRow, type DomainContext } from '@/server/domain';
import { isDomainError } from '@/server/errors';

const RESERVED = new Set(['new', 'by-link', 'deleted']);

/** True when `path` is a job page (`/jobs/<ref>...`) whose job is not in this workspace. */
export async function jobRouteMissing(ctx: DomainContext, path: string): Promise<boolean> {
  const match = /^\/jobs\/([^/?#]+)/.exec(path);
  if (!match) return false;
  let ref = match[1] ?? '';
  try {
    ref = decodeURIComponent(ref);
  } catch {
    return true;
  }
  if (RESERVED.has(ref)) return false;
  try {
    await getJobRow(ctx, ref);
    return false;
  } catch (error) {
    // Only "not found" is a 404. Anything else (the database is away) lets the page show its own error.
    return isDomainError(error) && error.code === 'NOT_FOUND';
  }
}
