/**
 * `defineRoute()` — the one way to build an API handler (BUILD_PLAN 0.2).
 *
 *   export const GET = defineRoute({
 *     permission: "fulfillment.shipment_orders.view",
 *     query: z.object({ status: z.string().optional() }),
 *     handler: async ({ db, auth, query, grid }) => listResult(await listOrders(db, ...), meta),
 *   });
 *
 * Pipeline: session (Better Auth `core.session`) → same-origin (non-GET) → permission → rate limit
 * (mutations) → zod params/query/body → handler → envelope. Mutations (and
 * `transaction: true`) run the handler inside `db.transaction(async (tx) => …)` after
 * `takeWriteLock(tx)`: one app-wide advisory lock, so writers are serialised exactly as with
 * SQLite and allocation / ledger / sequence logic needs no per-site locking. The handler gets
 * the transaction as `ctx.db` and MUST use only that handle (never the global db) for queries.
 * Domain errors map to `{ success:false, error, code, fieldErrors }`; a thrown error rolls the
 * transaction back. Stack traces never reach the client. Every request emits one log line.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { writeAudit, type AuditEntry } from '@/server/auth/audit';
import { buildAuthContext, type AuthContext } from '@/server/auth/context';
import { isSafeMethod, verifyOrigin } from '@/server/auth/origin';
import { canAny } from '@/server/auth/permissions';
import { auditIp, clientIp, hitRateLimit, RATE_LIMITS, type RateLimitPolicy } from '@/server/auth/rate-limit';
import { requireWmsEntitlement } from '@/server/auth/entitlements';
import { CONTEXT_CLIENT_COOKIE, CONTEXT_WAREHOUSE_COOKIE } from '@/server/auth/scope';
import { getRequestSession, readCookie } from '@/server/auth/session';
import { log } from '@/server/log';
import { parseGridQuery, type GridQuery } from '@/server/query/grid-query';
import { getPlatformDb, getTenantDbFor, type AppDb } from './db';
import { runWithTenant } from '@/server/tenancy/request';
import { withWriteTx } from '@/server/db/sql';
import { jsonError, jsonOk, isRouteResult } from './envelope';
import { AppError, forbiddenError, fromZodError, toAppError, unauthenticatedError } from './errors';
import { deepRedactFor } from '@/server/repositories/roles-redaction';
import { parseTzOffset, runWithTzOffset, TZ_OFFSET_HEADER } from '@/server/query/request-tz';

export const MAX_JSON_BODY_BYTES = 1_000_000;

type AuthMode = 'required' | 'public';
type Schema = z.ZodType | undefined;
type Out<S extends Schema, Fallback> = S extends z.ZodType ? z.output<S> : Fallback;

export interface RouteCtx<Q, B, P, A extends AuthMode> {
  readonly request: NextRequest;
  readonly requestId: string;
  readonly method: string;
  /** Database or, for mutations, the open transaction. */
  readonly db: AppDb;
  readonly auth: A extends 'public' ? AuthContext | null : AuthContext;
  readonly query: Q;
  readonly body: B;
  readonly params: P;
  readonly searchParams: URLSearchParams;
  /** Parses the grid grammar from the URL; throws VALIDATION on malformed parts. */
  grid(): GridQuery;
  /** Audit/display address: first `x-forwarded-for` hop — attacker-chosen, data only. */
  readonly ip: string;
  /**
   * Spoof-resistant rate-limit key (`clientIp`): honours `x-forwarded-for` only behind
   * a trusted proxy (TRUST_PROXY=1), otherwise the shared "direct" bucket. Routes that
   * hand-roll limits (forgot/reset) MUST key on this, never on `ip` (auth review H2).
   */
  readonly rateIp: string;
  readonly userAgent: string | null;
  /** For change_log / ledger calls: `{ userId, source: <email> }`. */
  readonly actor: { readonly userId: string | null; readonly source: string };
  /** Best-effort audit row (savepoint; never fails the request). Await it. */
  audit(entry: Omit<AuditEntry, 'userId' | 'ip' | 'userAgent'>): Promise<void>;
}

export interface RouteConfig<QS extends Schema, BS extends Schema, PS extends Schema, A extends AuthMode, R> {
  /** Label for logs; defaults to the request path. */
  readonly name?: string;
  readonly auth?: A;
  /** Required permission (any-of when an array). */
  readonly permission?: string | readonly string[];
  readonly query?: QS;
  readonly body?: BS;
  readonly params?: PS;
  /**
   * Same-origin check on non-GET (the CSRF token is retired — blueprint §1.4). Set
   * false only for endpoints that must accept cross-site posts (e.g. SAML ACS).
   */
  readonly csrf?: boolean;
  /** Default: `RATE_LIMITS.mutation` per user on non-GET. */
  readonly rateLimit?: RateLimitPolicy | false;
  /**
   * Default: true on non-GET. The handler then runs inside one Postgres transaction holding
   * the app write lock (`takeWriteLock`); `ctx.db` is that transaction.
   */
  readonly transaction?: boolean;
  readonly handler: (
    ctx: RouteCtx<Out<QS, Record<string, string>>, Out<BS, undefined>, Out<PS, Record<string, string>>, A>,
  ) => R | Promise<R>;
}

export interface RouteSegmentContext {
  readonly params: Promise<Record<string, string | string[] | undefined>>;
}

export type RouteHandler = (request: NextRequest, segment?: RouteSegmentContext) => Promise<Response>;

function parseWith<S extends z.ZodType>(schema: S, value: unknown, prefix: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw fromZodError(parsed.error, prefix);
  return parsed.data;
}

async function readJsonBody(request: NextRequest): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_JSON_BODY_BYTES) throw new AppError('VALIDATION', 'Request body is too large');
  const text = await request.text();
  if (text.length > MAX_JSON_BODY_BYTES) throw new AppError('VALIDATION', 'Request body is too large');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('VALIDATION', 'Request body must be valid JSON');
  }
}

/**
 * JSON envelope for a handler result. Role data restrictions (Manage Restrictions: carrier
 * cost, carrier account data, rate shopping data) are applied to every authenticated JSON
 * payload here, at any depth; raw `Response` values (files, streams) pass through untouched.
 */
function toResponse(value: unknown, requestId: string, auth: AuthContext | null): Response {
  if (value instanceof Response) return value;
  const headers = { 'x-request-id': requestId };
  const redact = <T>(v: T): T => (auth && auth.restrictions.length > 0 ? deepRedactFor(auth, v) : v);
  if (isRouteResult(value)) {
    return jsonOk(redact(value.data), {
      status: value.status,
      meta: value.meta,
      headers: { ...headers, ...(value.headers ?? {}) },
    });
  }
  return jsonOk(redact(value ?? null), { headers });
}

interface Guarded {
  readonly auth: AuthContext | null;
  /** The request's warehouse handle (the platform handle for anonymous requests). */
  readonly db: AppDb;
  /** The request's warehouse schema, when signed in. */
  readonly tenantSchema: string | null;
}

async function guard(
  platformDb: AppDb,
  request: NextRequest,
  config: {
    auth?: AuthMode;
    permission?: string | readonly string[];
    csrf?: boolean;
    rateLimit?: RateLimitPolicy | false;
  },
  meta: { ip: string; rateIp: string; userAgent: string | null; route: string },
): Promise<Guarded> {
  const mutation = !isSafeMethod(request.method);
  const session = await getRequestSession(platformDb, request);
  const required = (config.auth ?? 'required') === 'required';
  if (required && !session.ok) {
    // Signed in, but no org of theirs has a warehouse: not a sign-in problem.
    if (session.reason === 'no_warehouse')
      throw forbiddenError('Your organization does not have a KitStak WMS warehouse yet');
    throw unauthenticatedError();
  }

  // One separate warehouse per organization: everything below runs on the session org's
  // schema (the platform handle for the platform org and for anonymous requests).
  const tenantSchema = session.ok ? session.user.tenantSchema : null;
  const db = tenantSchema && tenantSchema !== 'wms' ? await getTenantDbFor(tenantSchema) : platformDb;

  // Module entitlement gate (BLUEPRINT.md §3.3): the request's org must hold the `wms`
  // module. `auth: 'public'` routes and the exempt paths (health, cron tick, bootstrap)
  // skip; dev/test default to allow-all (see @/server/auth/entitlements).
  if (required && session.ok)
    await requireWmsEntitlement(platformDb, session.user.orgId, new URL(request.url).pathname);

  const auth = session.ok
    ? await buildAuthContext(db, session.user, {
        warehouseId: readCookie(request, CONTEXT_WAREHOUSE_COOKIE) ?? null,
        clientId: readCookie(request, CONTEXT_CLIENT_COOKIE) ?? null,
      })
    : null;
  const audit = async (action: string, detail: Record<string, unknown>): Promise<void> =>
    await writeAudit(db, {
      action,
      entity: 'route',
      entityId: meta.route,
      userId: auth?.user.id ?? null,
      outcome: 'failure',
      detail,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

  if (mutation && config.csrf !== false) {
    const check = verifyOrigin(request);
    if (!check.ok) {
      await audit('security.csrf_rejected', { reason: check.reason, method: request.method });
      throw new AppError('CSRF', 'Cross-site requests are not allowed. Refresh the page and try again.');
    }
  }

  if (config.permission) {
    const keys = typeof config.permission === 'string' ? [config.permission] : config.permission;
    if (!auth || !canAny(auth, keys)) {
      await audit('security.permission_denied', { permission: keys, method: request.method });
      throw forbiddenError();
    }
  }

  const policy =
    config.rateLimit === undefined ? (mutation ? RATE_LIMITS.mutation : false) : config.rateLimit;
  if (policy) {
    const subject = auth?.user.id ?? `ip:${meta.rateIp}`;
    const limit = await hitRateLimit(db, policy, subject);
    if (!limit.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.', {
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      });
    }
  }
  return { auth, db, tenantSchema };
}

export function defineRoute<
  QS extends Schema = undefined,
  BS extends Schema = undefined,
  PS extends Schema = undefined,
  A extends AuthMode = 'required',
  R = unknown,
>(config: RouteConfig<QS, BS, PS, A, R>): RouteHandler {
  return async (request, segment) => {
    const started = Date.now();
    const requestId = randomUUID();
    const route = config.name ?? new URL(request.url).pathname;
    // Audit / session rows get the real client address; the rate-limit bucket keeps clientIp.
    const ip = auditIp(request);
    const rateIp = clientIp(request);
    const userAgent = request.headers.get('user-agent');
    let userId: string | null = null;
    let status = 500;
    let errorForLog: unknown;

    try {
      const platformDb = await getPlatformDb();
      const { auth, db, tenantSchema } = await guard(platformDb, request, config, {
        ip,
        rateIp,
        userAgent,
        route,
      });
      userId = auth?.user.id ?? null;

      const rawParams = segment ? await segment.params : {};
      const params = config.params ? parseWith(config.params, rawParams, 'Invalid path') : rawParams;
      const searchParams = new URL(request.url).searchParams;
      const rawQuery = Object.fromEntries(searchParams.entries());
      const query = config.query ? parseWith(config.query, rawQuery, 'Invalid query') : rawQuery;
      const body = config.body
        ? parseWith(config.body, await readJsonBody(request), 'Invalid request')
        : undefined;

      const makeCtx = (handle: AppDb) =>
        ({
          request,
          requestId,
          method: request.method,
          db: handle,
          auth,
          query,
          body,
          params,
          searchParams,
          grid: () => {
            const parsed = parseGridQuery(searchParams);
            const first = parsed.issues[0];
            if (first) {
              const fieldErrors = Object.fromEntries(parsed.issues.map((i) => [i.param, [i.message]]));
              throw new AppError('VALIDATION', `Invalid query: ${first.param}: ${first.message}`, {
                fieldErrors,
              });
            }
            return parsed.query;
          },
          ip,
          rateIp,
          userAgent,
          actor: { userId, source: auth?.user.email ?? 'System' },
          audit: async (entry: Omit<AuditEntry, 'userId' | 'ip' | 'userAgent'>) =>
            await writeAudit(handle, { ...entry, userId, ip, userAgent }),
        }) as RouteCtx<
          Out<QS, Record<string, string>>,
          Out<BS, undefined>,
          Out<PS, Record<string, string>>,
          A
        >;

      const useTx = config.transaction ?? !isSafeMethod(request.method);
      // The viewer's UTC offset (x-tz-offset) scopes grid date chips to local days for this request.
      const tzOffset = parseTzOffset(request.headers.get(TZ_OFFSET_HEADER));
      // Mutations: one transaction holding the app write lock (withWriteTx = db.transaction + takeWriteLock).
      const run = async () =>
        await runWithTzOffset(tzOffset, async () =>
          useTx
            ? await withWriteTx(db, async (tx) => await config.handler(makeCtx(tx)))
            : await config.handler(makeCtx(db)),
        );
      // Bind the warehouse so getAppDb() anywhere below (incl. after()) resolves the same org.
      const value = tenantSchema ? await runWithTenant(tenantSchema, run) : await run();

      const response = toResponse(value, requestId, auth);
      status = response.status;
      return response;
    } catch (error: unknown) {
      const appError = toAppError(error);
      status = appError.status;
      errorForLog = appError.code === 'INTERNAL' ? error : undefined;
      return jsonError(appError, requestId);
    } finally {
      const fields = { route, method: request.method, userId, ms: Date.now() - started, status, requestId };
      if (errorForLog !== undefined) log.error('request failed', { ...fields, err: errorForLog });
      else if (status >= 500) log.error('request', fields);
      else log.info('request', fields);
    }
  };
}
