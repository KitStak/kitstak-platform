/**
 * LEGACY SHIM — pre-foundation API helpers, kept so existing route handlers keep working.
 * New handlers must use `defineRoute()` from `@/server/api/define-route`.
 *
 * `requireSession` / `requireRole` now verify against `user_sessions` (revocation + sv),
 * and error bodies carry the foundation `code` alongside the legacy `error` string.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/server/auth/session';
import { AppError, type ErrorCode } from '@/server/api/errors';
import { failureBody, type ApiFailure } from '@/server/api/envelope';
import { log } from '@/server/log';

export { defineRoute } from '@/server/api/define-route';
export { AppError } from '@/server/api/errors';
export type { ApiEnvelope, ApiMeta } from '@/server/api/envelope';

interface LegacyMeta {
  total: number;
  page: number;
  pageSize: number;
}

export function ok<T>(
  data: T,
  meta?: LegacyMeta,
): NextResponse<{ success: true; data: T; meta?: LegacyMeta }> {
  return NextResponse.json(meta ? { success: true as const, data, meta } : { success: true as const, data });
}

function fail(code: ErrorCode, message: string): NextResponse<ApiFailure> {
  const error = new AppError(code, message);
  return NextResponse.json(failureBody(error), { status: error.status });
}

export const badRequest = (error: string): NextResponse<ApiFailure> => fail('VALIDATION', error);
export const notFound = (error = 'Not found'): NextResponse<ApiFailure> => fail('NOT_FOUND', error);
export const unauthorized = (error = 'Authentication required'): NextResponse<ApiFailure> =>
  fail('UNAUTHENTICATED', error);
export const forbidden = (error = 'Insufficient permissions'): NextResponse<ApiFailure> =>
  fail('FORBIDDEN', error);

/** Verifies the session (DB-backed). Returns a 401 response, or null when authenticated. */
export async function requireSession(): Promise<NextResponse<ApiFailure> | null> {
  const user = await getSessionUser();
  return user ? null : unauthorized();
}

/** Like requireSession, but also requires one of the legacy coarse roles. */
export async function requireRole(roles: readonly string[]): Promise<NextResponse<ApiFailure> | null> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return roles.includes(user.role) ? null : forbidden();
}

export function serverError(context: string, error: unknown): NextResponse<ApiFailure> {
  log.error('legacy route failed', { route: context, err: error });
  return fail('INTERNAL', 'Internal server error');
}

/** Base pagination/search query schema shared across legacy list endpoints. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Grid page sizes go up to 1000 (BUILD_PLAN 0.3: 100/300/500/700/1000).
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});

export function queryOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export function zodMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Invalid query';
  const path = first.path.join('.');
  return path ? `Invalid query: ${path}: ${first.message}` : `Invalid query: ${first.message}`;
}
