/**
 * `withApi()` — the single wrapper every `/api/v1` route handler uses.
 *
 * ```ts
 * export const PATCH = withApi(
 *   { permission: 'item:write', params: z.object({ itemId: z.uuid() }), body: patchItemSchema,
 *     audit: { action: 'item.updated', target: (ctx) => ({ type: 'item', id: ctx.params.itemId }) } },
 *   async (ctx) => itemsService.update(ctx.db, ctx.org.organization.id, ctx.params.itemId, ctx.body),
 * );
 * ```
 *
 * Pipeline: request id → origin check (mutations) → session → org membership → RBAC →
 * rate limit → Zod (params, query, body) → handler → envelope `{ ok, data, meta? }`.
 * Thrown `AppError`s map to `{ ok: false, error }`; anything else becomes a sanitized 500.
 *
 * Org scoping: the org is taken from route param `orgId`/`orgSlug` if present, else from the
 * `x-org-id` header. It is required whenever `permission` is set or `org: 'required'`.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { recordAudit, type AuditEvent } from '@/server/audit';
import {
  getSessionFromHeaders,
  findOrgMembership,
  type OrgMembership,
  type Session,
} from '@/server/auth/session';
import { mustChangePassword } from '@/server/auth/password-change';
import { db, type Database } from '@/server/db';
import { orgHasCrmModule } from '@/server/entitlements';
import { trustedOrigins } from '@/server/env';
import { ORG_HEADER, REQUEST_ID_HEADER, type ApiMeta } from '@/server/http/envelope';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  OrgRequiredError,
  toAppError,
  UnauthenticatedError,
} from '@/server/http/errors';
import { checkRequestOrigin, isMutatingMethod } from '@/server/http/origin';
import {
  clientIp,
  readJsonBody,
  searchParamsToObject,
  validate,
  DEFAULT_MAX_BODY_BYTES,
} from '@/server/http/request';
import { logger } from '@/server/logger';
import { enforceRateLimit, rateLimitHeaders, type RateLimitPolicyName } from '@/server/rate-limit';
import { hasPermission, type Permission } from '@/server/rbac';
import { enforceNetworkPolicy } from '@/server/services/admin-org';
import { authenticateApiToken, type TokenPrincipal } from '@/server/services/admin-token-auth';
import { effectiveTokenPermissions, scopesAllow } from '@/server/services/admin-token-scopes';

type AnySchema = z.ZodType;

export interface ApiOptions {
  /** Default `'required'`. */
  readonly auth?: 'required' | 'optional' | 'none';
  /** Org membership resolution. Defaults to `'required'` when `permission` is set, else `'optional'`. */
  readonly org?: 'required' | 'optional' | 'none';
  /** RBAC permission the caller's org role must grant. Implies `org: 'required'`. */
  readonly permission?: Permission;
  /** Policy name, or `false` to disable. Default: `'mutation'` for writes, `'default'` for reads. */
  readonly rateLimit?: RateLimitPolicyName | false;
  /** Rate-limit tokens consumed per call (bulk endpoints can charge more). */
  readonly rateLimitCost?: number;
  readonly params?: AnySchema;
  readonly query?: AnySchema;
  readonly body?: AnySchema;
  readonly maxBodyBytes?: number;
  /** Audit a successful call (security-relevant actions only). */
  readonly audit?: {
    readonly action: string;
    readonly target?: (ctx: AuditTargetContext) => { readonly type: string; readonly id: string } | null;
    readonly metadata?: (ctx: AuditTargetContext) => Record<string, unknown>;
  };
}

type Infer<S> = S extends AnySchema ? z.output<S> : undefined;
type SessionFor<O extends ApiOptions> = O['auth'] extends 'optional' | 'none' ? Session | null : Session;
type OrgFor<O extends ApiOptions> = O['permission'] extends Permission
  ? OrgMembership
  : O['org'] extends 'required'
    ? OrgMembership
    : OrgMembership | null;

export interface ApiContext<O extends ApiOptions = ApiOptions> {
  readonly request: Request;
  readonly requestId: string;
  readonly ip: string | null;
  readonly session: SessionFor<O>;
  readonly user: SessionFor<O> extends Session ? Session['user'] : Session['user'] | null;
  readonly org: OrgFor<O>;
  readonly params: Infer<O['params']>;
  readonly query: Infer<O['query']>;
  readonly body: Infer<O['body']>;
  readonly db: Database;
  /** Record an audit event scoped to the current org/actor. */
  audit(
    event: Omit<AuditEvent, 'orgId' | 'actorId' | 'ipAddress' | 'userAgent' | 'requestId'> & {
      orgId?: string;
    },
  ): Promise<void>;
}

export interface AuditTargetContext {
  readonly params: unknown;
  readonly body: unknown;
  readonly data: unknown;
}

const RESULT_BRAND: unique symbol = Symbol('kitstak.apiResult');

export interface ApiResult<T> {
  readonly [RESULT_BRAND]: true;
  readonly data: T;
  readonly meta?: ApiMeta;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Return from a handler to set `meta`, a non-200 status or extra headers. */
export function apiResult<T>(
  data: T,
  init: { meta?: ApiMeta; status?: number; headers?: Record<string, string> } = {},
): ApiResult<T> {
  return { [RESULT_BRAND]: true, data, ...init };
}

function isApiResult(value: unknown): value is ApiResult<unknown> {
  return typeof value === 'object' && value !== null && RESULT_BRAND in value;
}

type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };
export type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>;

const BASE_HEADERS: Readonly<Record<string, string>> = { 'Cache-Control': 'no-store' };

function errorResponse(error: AppError, requestId: string, extra: Record<string, string> = {}): Response {
  return NextResponse.json(
    { ok: false, error: error.toBody() },
    {
      status: error.status,
      headers: { ...BASE_HEADERS, ...extra, ...error.headers, [REQUEST_ID_HEADER]: requestId },
    },
  );
}

function pickOrgKey(
  rawParams: Record<string, string | string[] | undefined>,
  headers: Headers,
): string | null {
  for (const name of ['orgId', 'orgSlug'] as const) {
    const value = rawParams[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  const header = headers.get(ORG_HEADER);
  return header && header.trim().length > 0 ? header.trim() : null;
}

export function withApi<const O extends ApiOptions, T>(
  options: O,
  handler: (ctx: ApiContext<O>) => Promise<T | ApiResult<T> | Response> | T | ApiResult<T> | Response,
): RouteHandler {
  const authMode = options.auth ?? 'required';
  const orgMode = options.permission ? 'required' : (options.org ?? 'optional');

  return async (request, routeContext) => {
    const requestId = request.headers.get(REQUEST_ID_HEADER)?.slice(0, 64) || crypto.randomUUID();
    const ip = clientIp(request.headers);
    const method = request.method.toUpperCase();
    let auditOrgId: string | null = null;
    let actorId: string | null = null;
    let rateHeaders: Record<string, string> = {};

    try {
      const origin = checkRequestOrigin(method, request.headers, request.url, trustedOrigins());
      if (!origin.ok) throw new ForbiddenError('Cross-origin request blocked', { reason: origin.reason });

      // Personal API tokens (`Authorization: Bearer ks_live_…`) take precedence over cookies.
      const tokenAuth: TokenPrincipal | null = authMode === 'none' ? null : await authenticateApiToken(request.headers);
      const session =
        authMode === 'none' ? null : (tokenAuth?.session ?? (await getSessionFromHeaders(request.headers)));
      if (authMode === 'required' && !session) throw new UnauthenticatedError();
      if (tokenAuth && !options.permission) {
        throw new ForbiddenError('This endpoint does not accept API tokens', { reason: 'token_not_allowed' });
      }
      actorId = session?.user.id ?? null;
      // A browser session still on an administrator-set password may not use the API: the page
      // guard alone would leave room to mint an API token that outlives the password change.
      // Tokens are unaffected (none can exist before the first change).
      if (session && !tokenAuth && (await mustChangePassword(session.user.id))) {
        throw new ForbiddenError('Choose a new password to continue', { reason: 'password_change_required' });
      }

      const rawParams = (await routeContext.params) ?? {};
      let membership: OrgMembership | null = null;
      if (orgMode !== 'none' && session) {
        const orgKey = pickOrgKey(rawParams, request.headers) ?? tokenAuth?.orgId ?? null;
        if (orgKey) {
          membership = await findOrgMembership(session.user.id, orgKey);
          if (!membership) throw new NotFoundError('Organization');
          // A token only works inside the org it was issued for.
          if (tokenAuth && membership.organization.id !== tokenAuth.orgId) throw new NotFoundError('Organization');
          auditOrgId = membership.organization.id;
        }
      }
      if (orgMode === 'required' && !membership) {
        throw session
          ? new OrgRequiredError()
          : new UnauthenticatedError();
      }
      // Org IP allow-list (admin center → Security). Cached per org; no-op when disabled.
      if (membership) await enforceNetworkPolicy(membership.organization.id, ip);

      // Module entitlement gate (BLUEPRINT.md §3.3), after org resolution and before RBAC:
      // org-scoped calls require the `crm` module (dev/test default to allow-all — see
      // @/server/entitlements). Routes without an org in play (org: 'none', or optional
      // with none named) skip. The 402 envelope is fixed shape, outside the AppError map.
      if (membership && !(await orgHasCrmModule(membership.organization.id))) {
        return NextResponse.json(
          { ok: false, error: { code: 'entitlement.missing', module: 'crm' } },
          { status: 402, headers: { ...BASE_HEADERS, [REQUEST_ID_HEADER]: requestId } },
        );
      }

      const tokenDenied =
        tokenAuth !== null && options.permission !== undefined && !scopesAllow(tokenAuth.scopes, options.permission);
      if (options.permission && membership && (tokenDenied || !hasPermission(membership.roles, options.permission))) {
        // AWAITED: fire-and-forget left the audit INSERT in flight when the 403 ended the
        // response; a serverless suspend then freezes it mid-query and wedges the pooled
        // connection (`recordAudit` never throws).
        await recordAudit({
          orgId: membership.organization.id,
          actorId,
          action: 'auth.forbidden',
          targetType: 'permission',
          targetId: options.permission,
          ipAddress: ip,
          userAgent: request.headers.get('user-agent'),
          requestId,
          metadata: {
            method,
            path: new URL(request.url).pathname,
            role: membership.role,
            ...(tokenAuth ? { via: 'api_token', tokenId: tokenAuth.tokenId, scopes: tokenAuth.scopes } : {}),
          },
        });
        throw new ForbiddenError(
          tokenDenied ? 'This API token does not have the scope for this request' : undefined,
          { permission: options.permission },
        );
      }
      if (tokenAuth && membership) {
        membership = { ...membership, permissions: effectiveTokenPermissions(membership.permissions, tokenAuth.scopes) };
      }

      if (options.rateLimit !== false) {
        const policy = options.rateLimit ?? (isMutatingMethod(method) ? 'mutation' : 'default');
        const decision = enforceRateLimit(
          policy,
          actorId ?? `ip:${ip ?? 'unknown'}`,
          options.rateLimitCost ?? 1,
        );
        rateHeaders = rateLimitHeaders(decision);
      }

      const params = options.params ? validate(options.params, rawParams, 'params') : undefined;
      const query = options.query
        ? validate(options.query, searchParamsToObject(new URL(request.url).searchParams), 'query')
        : undefined;
      const body = options.body
        ? validate(
            options.body,
            await readJsonBody(request, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES),
            'body',
          )
        : undefined;

      const ctx = {
        request,
        requestId,
        ip,
        session,
        user: session?.user ?? null,
        org: membership,
        params,
        query,
        body,
        db,
        audit: (event) => {
          const orgId = event.orgId ?? membership?.organization.id;
          if (!orgId) return Promise.resolve();
          return recordAudit({
            ...event,
            orgId,
            actorId,
            ipAddress: ip,
            userAgent: request.headers.get('user-agent'),
            requestId,
          });
        },
      } as ApiContext<O>;

      const output = await handler(ctx);
      if (output instanceof Response) {
        output.headers.set(REQUEST_ID_HEADER, requestId);
        return output;
      }

      const result = isApiResult(output) ? output : apiResult(output as T);
      if (options.audit && membership) {
        const targetCtx: AuditTargetContext = { params, body, data: result.data };
        const target = options.audit.target?.(targetCtx) ?? null;
        await recordAudit({
          orgId: membership.organization.id,
          actorId,
          action: options.audit.action,
          targetType: target?.type,
          targetId: target?.id,
          ipAddress: ip,
          userAgent: request.headers.get('user-agent'),
          requestId,
          metadata: options.audit.metadata?.(targetCtx),
        });
      }

      const envelope = result.meta
        ? { ok: true, data: result.data ?? null, meta: result.meta }
        : { ok: true, data: result.data ?? null };
      return NextResponse.json(envelope, {
        status: result.status ?? 200,
        headers: { ...BASE_HEADERS, ...rateHeaders, ...result.headers, [REQUEST_ID_HEADER]: requestId },
      });
    } catch (thrown) {
      const error = toAppError(thrown);
      if (error.status >= 500) {
        logger.error('api.unhandled_error', {
          requestId,
          method,
          path: new URL(request.url).pathname,
          orgId: auditOrgId,
          actorId,
          error: thrown,
        });
      }
      return errorResponse(error, requestId, rateHeaders);
    }
  };
}
