/**
 * Shared helpers for `/api/v1` route handlers (folder is private: `_lib` is not routed).
 * Handlers stay thin: validate (withApi) → service → envelope.
 */
import 'server-only';
import { z } from 'zod';
import { apiResult, type ApiContext, type ApiOptions, type ApiResult } from '@/server/api';
import type { OrgMembership } from '@/server/auth/session';
import { serviceContext, type ServiceContext } from '@/server/services/context';
import type { Page } from '@/server/services/pagination';

/** Params schema with one uuid per route segment name. */
export function uuidParams<const K extends string>(...names: K[]): z.ZodObject<Record<K, z.ZodUUID>> {
  return z.object(Object.fromEntries(names.map((name) => [name, z.uuid()])) as Record<K, z.ZodUUID>);
}

/** Service context for an org-scoped handler. */
export function svc<O extends ApiOptions>(ctx: ApiContext<O>): ServiceContext {
  return serviceContext({ db: ctx.db, org: ctx.org as OrgMembership, user: ctx.user });
}

/** Paginated envelope: `{ ok, data: items, meta: { nextCursor } }`. */
export function paged<T>(page: Page<T>, extra: Record<string, unknown> = {}): ApiResult<T[]> {
  return apiResult(page.items, { meta: { nextCursor: page.nextCursor, ...extra } });
}

export function created<T>(data: T): ApiResult<T> {
  return apiResult(data, { status: 201 });
}

export const emptyBody = z.object({}).strict().optional();

export const runtime = 'nodejs';
