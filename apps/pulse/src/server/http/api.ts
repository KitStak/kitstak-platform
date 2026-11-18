/**
 * JSON route handler wrapper for /api/v1/*. Envelope: `{ data }` on success,
 * `{ error: { code, message, fields? } }` with the matching HTTP status on failure.
 *
 *   export const GET = apiRoute(async ({ ctx }) => listOrgPeople(ctx));
 *
 * Auth: the shared KitStak session cookie, same-org only (the active org of the session).
 * The Pulse API is same origin by design: sibling apps read through `@kitstak/pulse-bridge` on
 * their own servers, so routes send no CORS headers. `cors: true` exists for the rare route that
 * must answer a trusted sibling origin (Portal, CRM, WMS, Projects) with credentials; every other
 * origin gets nothing. Writes pass the CSRF guard (`assertSafeOrigin`).
 *
 * CSV downloads use `csvResponse` (the JSON envelope does not apply to files).
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { orgHasPulseModule } from '@/server/entitlements';
import { trustedOrigins } from '@/server/env';
import { DomainError, isDomainError } from '@/server/errors';
import { getApiContext, type PulseContext } from '@/server/session';

export interface ApiArgs<P> {
  readonly ctx: DomainContext;
  readonly context: PulseContext;
  readonly request: Request;
  readonly params: P;
  readonly searchParams: URLSearchParams;
}

export interface ApiOptions {
  /** Allow credentialed calls from trusted sibling origins (Portal, CRM, WMS, Projects). */
  readonly cors?: boolean;
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
  console.error('[pulse] api error', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } },
    { status: 500, headers },
  );
}

type RouteContext<P> = { params: Promise<P> };

const META = Symbol('pulse.api.meta');
interface WithMeta<T> {
  readonly [META]: Readonly<Record<string, unknown>>;
  readonly data: T;
}

/** A list answer with paging facts next to it: `{ data, meta }` (meta is never inside `data`). */
export function withMeta<T>(data: T, meta: Readonly<Record<string, unknown>>): WithMeta<T> {
  return { [META]: meta, data };
}

function isWithMeta(value: unknown): value is WithMeta<unknown> {
  return typeof value === 'object' && value !== null && META in value;
}

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
      if (!(await orgHasPulseModule(context.org.id))) {
        throw new DomainError('NOT_ENTITLED', 'KitStak Pulse is not turned on for this organization.');
      }
      const params = route?.params ? await route.params : ({} as P);
      const data = await handler({
        ctx: toDomainContext(context),
        context,
        request,
        params,
        searchParams: new URL(request.url).searchParams,
      });
      const body = isWithMeta(data) ? { data: data.data ?? null, meta: data[META] } : { data: data ?? null };
      return NextResponse.json(body, { headers: cors });
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

/** Safe file name part: letters, digits, dot, dash and underscore only. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'export.csv';
}

/**
 * A CSV file download. Adds the byte order mark Excel needs and never lets the browser cache it.
 * `body` is the finished CSV text (CRLF line ends, formula guard already applied by the writer).
 */
export function csvResponse(fileName: string, body: string): NextResponse {
  const withBom = body.startsWith('\uFEFF') ? body : `\uFEFF${body}`;
  return new NextResponse(withBom, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFileName(fileName)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function boolParam(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === '1' || value === 'true';
}
