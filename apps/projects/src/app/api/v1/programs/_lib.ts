/**
 * Helpers for the program routes (docs/programs/SPEC.md 4.7): query parsing and file downloads.
 * File routes use the same session and entitlement checks as `apiRoute`, then answer with the file.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { orgHasProjectsModule } from '@/server/entitlements';
import { DomainError } from '@/server/errors';
import { errorResponse } from '@/server/http/api';
import { getApiContext } from '@/server/session';

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function dateParam(value: string | null): string | undefined {
  return value && ISO_DATE.test(value) ? value : undefined;
}

export function monthParam(value: string | null): string | undefined {
  return value && ISO_MONTH.test(value) ? value : undefined;
}

export function listParam(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items.slice(0, 100) : undefined;
}

export function requireMonth(value: string | null): string {
  const month = monthParam(value);
  if (!month) throw new DomainError('VALIDATION', 'Pick a month.', { month: 'Pick a month.' });
  return month;
}

export interface FileBody {
  readonly filename: string;
  readonly body: string | Uint8Array;
  readonly contentType: string;
}

/** A download route: `Content-Disposition: attachment; filename="..."`. */
export function fileRoute<P>(handler: (args: { ctx: DomainContext; params: P; searchParams: URLSearchParams; request: Request }) => Promise<FileBody>) {
  return async (request: Request, route: { params: Promise<P> }): Promise<Response> => {
    try {
      const context = await getApiContext(request);
      if (!context) throw new DomainError('UNAUTHENTICATED', 'Sign in to KitStak to continue.');
      if (!(await orgHasProjectsModule(context.org.id))) throw new DomainError('NOT_ENTITLED', 'KitStak Projects is not turned on for this organization.');
      const file = await handler({ ctx: toDomainContext(context), params: await route.params, searchParams: new URL(request.url).searchParams, request });
      const body = typeof file.body === 'string' ? file.body : new Blob([new Uint8Array(file.body)], { type: file.contentType });
      return new NextResponse(body, {
        headers: {
          'Content-Type': file.contentType,
          'Content-Disposition': `attachment; filename="${file.filename.replace(/"/g, '')}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
