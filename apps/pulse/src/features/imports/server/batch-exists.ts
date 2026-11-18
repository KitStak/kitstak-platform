/** Real 404 for `/import/<batch>`: checked in the (app) layout, before the page starts streaming. */
import 'server-only';
import type { DomainContext } from '@/server/domain/_shared';
import { importBatchExists } from '@/server/domain/imports';

export async function importRouteMissing(ctx: DomainContext, path: string): Promise<boolean> {
  const match = /^\/import\/([^/?#]+)/.exec(path);
  if (!match || match[1] === 'new') return false;
  try {
    return !(await importBatchExists(ctx, decodeURIComponent(match[1] ?? '')));
  } catch {
    return false;
  }
}
