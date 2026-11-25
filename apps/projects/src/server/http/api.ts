/**
 * JSON route handler wrapper for /api/v1/*. Envelope: `{ data }` on success,
 * `{ error: { code, message, fields? } }` with the matching HTTP status on failure.
 *
 *   export const GET = apiRoute(async ({ ctx, request, params }) => listSpaces(ctx));
 *
 * Auth: the shared KitStak session cookie (works for same-site sibling apps), same-org only
 * (the active org of the session). Optional `cors: true` lets the trusted sibling origins
 * (Portal/CRM/WMS) call with credentials; every other origin gets no CORS headers.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { trustedOrigins } from '@/server/env';
import { DomainError, isDomainError } from '@/server/errors';
import { assertPlanAllows, isPlanSafeMethod } from '@/server/plan-gate';
import { getApiContext, type ProjectsContext } from '@/server/session';

export interface ApiArgs<P> {
  readonly ctx: DomainContext;
  readonly context: ProjectsContext;
  readonly request: Request;
  readonly params: P;
  readonly searchParams: URLSearchParams;
}

export interface ApiOptions {
  /** Allow credentialed calls from trusted sibling origins (Portal/CRM/WMS). */
  readonly cors?: boolean;
  /**
   * Marks a route that is not GET or HEAD but changes no business data (a query or an export sent
   * as POST). It keeps working while the plan is view only. Every other write method is refused.
   */
  readonly planRead?: boolean;
}

function corsHeaders(request: Request, enabled: boolean): Record<string, string> {
  if (!enabled) return {};
  const origin = request.headers.get('origin');
  if (!origin) return {};
  let allowed: string[] = [];
  try {
    allowed = trustedOrigins();
  } catch {
    return {};
  }
  if (!allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** CSRF guard: writes must come from this app or a trusted sibling origin. */
function assertSafeOrigin(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
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

export function errorResponse(error: unknown, headers: Record<string, string> = {}): NextResponse {
  if (isDomainError(error)) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } },
      { status: error.status, headers },
    );
  }
  console.error('[projects] api error', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } },
    { status: 500, headers },
  );
}

type RouteContext<P> = { params: Promise<P> };

export function apiRoute<P = Record<string, never>, T = unknown>(
  handler: (args: ApiArgs<P>) => Promise<T>,
  options: ApiOptions = {},
) {
  return async (request: Request, route: RouteContext<P>): Promise<NextResponse> => {
    const cors = corsHeaders(request, Boolean(options.cors));
    try {
      assertSafeOrigin(request);
      const context = await getApiContext(request);
      if (!context) throw new DomainError('UNAUTHENTICATED', 'Sign in to KitStak to continue.');
      // Plan gate: not in the plan refuses everything; view only lets reads through and refuses
      // every other method, unless the route is marked as a read (`planRead`).
      await assertPlanAllows(context.org.id, { write: !isPlanSafeMethod(request.method) && options.planRead !== true });
      const params = route?.params ? await route.params : ({} as P);
      const data = await handler({
        ctx: toDomainContext(context),
        context,
        request,
        params,
        searchParams: new URL(request.url).searchParams,
      });
      return NextResponse.json({ data: data ?? null }, { headers: cors });
    } catch (error) {
      return errorResponse(error, cors);
    }
  };
}

/** Preflight handler for CORS-enabled routes. */
export function corsPreflight() {
  return async (request: Request): Promise<NextResponse> =>
    new NextResponse(null, { status: 204, headers: corsHeaders(request, true) });
}

/** Parses a JSON body; throws VALIDATION on bad JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError('VALIDATION', 'The request body must be valid JSON.');
  }
}

export function boolParam(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === '1' || value === 'true';
}
