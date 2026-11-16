/**
 * The warehouse (tenant schema) the current request works in.
 *
 * - `defineRoute` binds it explicitly with `runWithTenant` once the session is resolved, so
 *   anything reached from a handler (incl. `after()` work) that calls `getAppDb()` gets the
 *   same org's handle.
 * - Server components / legacy routes fall back to the request's session user
 *   (`getSessionUser`, memoised per render).
 * - Outside a request (scripts, tests, scheduler bootstrap) there is no tenant: null, and
 *   callers use the platform handle or pass a tenant handle explicitly.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

/** Runs `fn` with `schemaName` as the request's warehouse. */
export function runWithTenant<T>(schemaName: string, fn: () => Promise<T>): Promise<T> {
  return storage.run(schemaName, fn);
}

/** True for Next/React control-flow signals that must propagate (dynamic usage, redirect, postpone). */
function isFrameworkSignal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return typeof (error as { digest?: unknown }).digest === 'string' || '$$typeof' in error;
}

/** True inside a Next request (headers available) or a bound tenant scope. */
export async function inRequestScope(): Promise<boolean> {
  if (storage.getStore()) return true;
  try {
    const { headers } = await import('next/headers');
    await headers();
    return true;
  } catch (error: unknown) {
    if (isFrameworkSignal(error)) throw error;
    return false;
  }
}

/** The bound tenant, else the session user's, else null (no request / signed out). */
export async function currentTenantSchema(): Promise<string | null> {
  const bound = storage.getStore();
  if (bound) return bound;
  try {
    const { headers } = await import('next/headers');
    await headers();
  } catch (error: unknown) {
    if (isFrameworkSignal(error)) throw error;
    return null; // not inside a request
  }
  const { getSessionUser } = await import('@/server/auth/session');
  return (await getSessionUser())?.tenantSchema ?? null;
}
