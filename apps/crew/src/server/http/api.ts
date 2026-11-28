/**
 * JSON route handler wrapper for /api/v1/* (the Pulse pattern). Envelope: `{ data }` on success,
 * `{ error: { code, message, fields? } }` with the matching HTTP status on failure.
 *
 *   export const GET = apiRoute(async ({ ctx }) => crewAccessFor(ctx));
 *
 * Auth: the shared KitStak session cookie, the active org of the session. Same origin only:
 * sibling apps read Crew through `@kitstak/crew-bridge` on their own servers. Writes pass the CSRF
 * guard (`assertSafeOrigin`) and must send JSON. A workspace outside the preview answers 402
 * NOT_ENTITLED (SPEC 3.4).
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { withOrg } from '@/server/db/scope';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { assertPlanAllows, isPlanSafeMethod } from '@/server/plan-gate';
import { trustedOrigins } from '@/server/env';
import { DomainError, isDomainError } from '@/server/errors';
import { getApiContext, type CrewContext } from '@/server/session';

export interface ApiArgs<P> {
  readonly ctx: DomainContext;
  readonly context: CrewContext;
  readonly request: Request;
  readonly params: P;
  readonly searchParams: URLSearchParams;
}

/** CSRF guard: writes must come from this app or a trusted sibling origin. */
export function assertSafeOrigin(request: Request): void {
  if (isPlanSafeMethod(request.method)) return;
  const origin = request.headers.get('origin');
  if (origin) {
    let allowed: string[] = [];
    try {
      allowed = trustedOrigins();
    } catch {
      allowed = [];
    }
    if (origin === new URL(request.url).origin || allowed.includes(origin)) return;
    throw new DomainError('FORBIDDEN', 'This request came from a site that is not allowed to change your data.');
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new DomainError('FORBIDDEN', 'This request came from a site that is not allowed to change your data.');
  }
}

/** Writes carry JSON (SPEC 8.8). */
function assertJsonBody(request: Request): void {
  if (isPlanSafeMethod(request.method)) return;
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) throw new DomainError('VALIDATION', 'Send the request as JSON.');
}

export function errorResponse(error: unknown, requestId?: string): NextResponse {
  if (isDomainError(error)) {
    return NextResponse.json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } }, { status: error.status });
  }
  console.error('[crew] api error', { requestId, error });
  return NextResponse.json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } }, { status: 500 });
}

type RouteContext<P> = { params: Promise<P> };

export function apiRoute<P = Record<string, never>, T = unknown>(handler: (args: ApiArgs<P>) => Promise<T>) {
  return async (request: Request, route: RouteContext<P>): Promise<NextResponse> => {
    const requestId = request.headers.get('x-vercel-id') ?? crypto.randomUUID();
    try {
      assertSafeOrigin(request);
      assertJsonBody(request);
      const context = await getApiContext(request);
      if (!context) throw new DomainError('UNAUTHENTICATED', 'Sign in to KitStak to continue.');
      await assertPlanAllows(context.org, { write: !isPlanSafeMethod(request.method) });
      const params = route?.params ? await route.params : ({} as P);
      const ctx = toDomainContext(context);
      const searchParams = new URL(request.url).searchParams;
      // The whole handler runs for one workspace: the database guard ties every statement to it.
      const data = await withOrg(context.org.id, () => handler({ ctx, context, request, params, searchParams }));
      return NextResponse.json({ data: data ?? null });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

/** Parses a JSON body; throws VALIDATION on bad JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError('VALIDATION', 'The request body must be valid JSON.');
  }
}
