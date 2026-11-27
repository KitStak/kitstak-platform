/**
 * Browser API client (BUILD_PLAN F4.1). Talks to `defineRoute` handlers:
 *   success: { success: true, data, meta? }
 *   failure: { success: false, error, code, fieldErrors?, requestId? }
 *
 * CSRF: the double-submit token is retired (blueprint §1.4) — cookies are SameSite=Lax
 * and `defineRoute` enforces a same-origin check on every mutation, so requests carry no
 * `x-csrf-token` header any more. A 401 sends the browser to `/login?next=<current path>`.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export interface ApiMeta {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly [key: string]: unknown;
}

export interface ApiErrorInit {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;
  readonly requestId?: string;
  readonly planUrl?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors: FieldErrors;
  readonly requestId?: string;
  /** With `PLAN_WAREHOUSE_LIMIT` and `PLAN_SEAT_LIMIT`: where the person can make the plan bigger. */
  readonly planUrl?: string;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.fieldErrors = init.fieldErrors ?? {};
    this.requestId = init.requestId;
    this.planUrl = init.planUrl;
  }

  /** First message for a field (dot path), if the server reported one. */
  fieldMessage(path: string): string | undefined {
    return this.fieldErrors[path]?.[0];
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

export interface ApiRequestOptions {
  readonly method?: HttpMethod;
  /** JSON-serialisable body, or FormData/Blob sent as-is. */
  readonly body?: unknown;
  /** Appended to the path; arrays repeat the key; null/undefined/"" are skipped. */
  readonly query?: string | URLSearchParams | Readonly<Record<string, QueryValue>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** Skip the 401 → /login redirect (login page, background polls). */
  readonly skipAuthRedirect?: boolean;
}

export interface ApiResponse<T> {
  readonly data: T;
  readonly meta?: ApiMeta;
}

/** Mirrors `TZ_OFFSET_HEADER` in server/query/request-tz (not imported: that module is server-only). */
const TZ_HEADER = 'x-tz-offset';
const LOGIN_PATH = '/login';
const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your connection and try again.';
const UNEXPECTED_ERROR_MESSAGE = 'The server returned an unexpected response.';

/* ---------------- request building ---------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildQueryString(query: ApiRequestOptions['query']): string {
  if (query === undefined) return '';
  if (typeof query === 'string') return query.replace(/^\?/, '');
  if (query instanceof URLSearchParams) return query.toString();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export function buildUrl(path: string, query?: ApiRequestOptions['query']): string {
  const qs = buildQueryString(query);
  if (!qs) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

function encodeBody(body: unknown): { body?: BodyInit; contentType?: string } {
  if (body === undefined) return {};
  if (typeof FormData !== 'undefined' && body instanceof FormData) return { body };
  if (typeof Blob !== 'undefined' && body instanceof Blob) return { body };
  return { body: JSON.stringify(body), contentType: 'application/json' };
}

async function send(path: string, options: ApiRequestOptions): Promise<Response> {
  const method = options.method ?? 'GET';
  const encoded = encodeBody(options.body);
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (encoded.contentType) headers['content-type'] = encoded.contentType;
  // Viewer's UTC offset (minutes east), so server date chips cut at local midnight.
  if (!(TZ_HEADER in headers)) headers[TZ_HEADER] = String(-new Date().getTimezoneOffset());
  try {
    return await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: encoded.body,
      signal: options.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({ code: 'NETWORK', message: NETWORK_ERROR_MESSAGE, status: 0 });
  }
}

/* ---------------- response handling ---------------- */

function toFieldErrors(value: unknown): FieldErrors | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, readonly string[]> = {};
  for (const [key, messages] of Object.entries(value)) {
    if (Array.isArray(messages)) out[key] = messages.filter((m): m is string => typeof m === 'string');
    else if (typeof messages === 'string') out[key] = [messages];
  }
  return out;
}

function errorFromBody(status: number, body: unknown): ApiError {
  if (isRecord(body) && body.success === false) {
    return new ApiError({
      code: typeof body.code === 'string' ? body.code : 'INTERNAL',
      message: typeof body.error === 'string' && body.error ? body.error : UNEXPECTED_ERROR_MESSAGE,
      status,
      fieldErrors: toFieldErrors(body.fieldErrors),
      requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
      planUrl: typeof body.planUrl === 'string' ? body.planUrl : undefined,
    });
  }
  return new ApiError({
    code: status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL',
    message: UNEXPECTED_ERROR_MESSAGE,
    status,
  });
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Sends the browser to the login page, preserving where the user was. */
export function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname.startsWith(LOGIN_PATH)) return;
  const next = encodeURIComponent(`${pathname}${search}`);
  // A full navigation is intended: it drops all client state of the expired session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${LOGIN_PATH}?next=${next}`;
}

const SESSION_RECHECK_MS = 5000;
let sessionRecheck: Promise<boolean> | null = null;

/**
 * True when `GET /api/me` also answers 401 (the session really ended). One slow or garbled
 * 401 under load must not log the user out; concurrent 401s share one re-check.
 */
export function sessionReallyEnded(): Promise<boolean> {
  if (sessionRecheck) return sessionRecheck;
  sessionRecheck = (async () => {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), SESSION_RECHECK_MS) : null;
    try {
      const res = await fetch('/api/me', {
        headers: { accept: 'application/json' },
        signal: controller?.signal,
        credentials: 'same-origin',
      });
      return res.status === 401;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      setTimeout(() => {
        sessionRecheck = null;
      }, 1000);
    }
  })();
  return sessionRecheck;
}

/**
 * Full request: returns `{ data, meta }`. Throws `ApiError` on any failure
 * (network failures use code `NETWORK`, status 0).
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const res = await send(path, options);
  const body = await readBody(res);

  // Confirm with /api/me before leaving: redirect only when the session is really gone.
  if (
    res.status === 401 &&
    !options.skipAuthRedirect &&
    (path.startsWith('/api/me') || (await sessionReallyEnded()))
  )
    redirectToLogin();

  if (!res.ok || !isRecord(body) || body.success !== true) {
    if (res.ok && body === null) return { data: undefined as T };
    throw errorFromBody(res.status, body);
  }
  return { data: body.data as T, ...(isRecord(body.meta) ? { meta: body.meta as unknown as ApiMeta } : {}) };
}

/** Unwrapped `data` only. */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { data } = await apiRequest<T>(path, options);
  return data;
}

/** Test hook: reset module-level client state between tests. */
export function resetApiClientForTests(): void {
  sessionRecheck = null;
}
