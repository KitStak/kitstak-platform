/**
 * Route wrapper for downloads (CSV files, pages to print). Same checks as `apiRoute` (session,
 * active org, `pulse` entitlement), but the handler may answer with a finished file `Response`.
 * Anything else it returns is sent in the usual `{ data }` envelope; errors use the JSON envelope.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { toDomainContext } from '@/server/domain/_shared';
import { orgHasPulseModule } from '@/server/entitlements';
import { DomainError } from '@/server/errors';
import { errorResponse, type ApiArgs } from '@/server/http/api';
import { PRINT_PAGE_CONTENT_SECURITY_POLICY } from '@/server/http/csp';
import { getApiContext } from '@/server/session';

export function fileRoute<P = Record<string, never>>(handler: (args: ApiArgs<P>) => Promise<unknown>) {
  return async (request: Request, route: { params: Promise<P> }): Promise<Response> => {
    try {
      const context = await getApiContext(request);
      if (!context) throw new DomainError('UNAUTHENTICATED', 'Sign in to KitStak to continue.');
      if (!(await orgHasPulseModule(context.org.id))) throw new DomainError('NOT_ENTITLED', 'KitStak Pulse is not turned on for this organization.');
      const params = route?.params ? await route.params : ({} as P);
      const result = await handler({ ctx: toDomainContext(context), context, request, params, searchParams: new URL(request.url).searchParams });
      if (result instanceof Response) return result;
      return NextResponse.json({ data: result ?? null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** A self contained HTML page (a report to print). Scripts and outside files are locked down. */
export function htmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': PRINT_PAGE_CONTENT_SECURITY_POLICY,
    },
  });
}
