/**
 * Minimal Logiwa iO HTTP client. It can only log in (one fixed POST) and GET paths from the
 * endpoints table; any other method or path throws before a request is made. Tokens live in memory
 * only and are never logged or returned to the model.
 */
import type { Config } from './config.js';
import { isAllowedGet, TOKEN_PATH } from './endpoints.js';

export type Fetch = typeof fetch;
export type Query = Readonly<Record<string, string>>;

export class LogiwaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface Page {
  rows: Record<string, unknown>[];
  /** Total record count when Logiwa reports one. */
  total: number | null;
}

export class LogiwaClient {
  private token: string | null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly config: Config,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.token = config.auth.kind === 'token' ? config.auth.token : null;
  }

  /** Logs in (when using email/password) so a bad credential fails at startup, not mid-chat. */
  async verify(): Promise<void> {
    if (this.config.auth.kind === 'password') await this.login();
  }

  async get(path: string, query: Query = {}): Promise<unknown> {
    if (!isAllowedGet(path)) throw new LogiwaError(`Blocked: ${path} is not an allowed read-only path.`);
    const url = new URL(this.config.baseUrl + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    let res = await this.send(url, await this.bearer());
    if (res.status === 401 && this.config.auth.kind === 'password') {
      this.token = null;
      res = await this.send(url, await this.bearer());
    }
    const body = await readBody(res);
    if (!res.ok)
      throw new LogiwaError(`Logiwa returned ${res.status} for ${path}: ${errorText(body)}`, res.status);
    if (isRecord(body) && (body.success === false || body.Success === false)) {
      throw new LogiwaError(`Logiwa reported a failure for ${path}: ${errorText(body)}`, res.status);
    }
    return body;
  }

  private async bearer(): Promise<string> {
    if (this.config.auth.kind === 'token') return this.token!;
    if (!this.token || Date.now() > this.tokenExpiresAt - 60_000) await this.login();
    return this.token!;
  }

  private async login(): Promise<void> {
    if (this.config.auth.kind !== 'password') return;
    const res = await this.fetchImpl(this.config.baseUrl + TOKEN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: this.config.auth.email, password: this.config.auth.password }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const body = await readBody(res);
    const token = isRecord(body)
      ? (pickString(body, ['token', 'Token', 'accessToken', 'access_token']) ??
        (isRecord(body.data)
          ? pickString(body.data, ['token', 'Token', 'accessToken', 'access_token'])
          : null))
      : null;
    if (!res.ok || !token) {
      throw new LogiwaError(
        `Logiwa login failed (${res.status}). Check the API user email and password.`,
        res.status,
      );
    }
    this.token = token;
    this.tokenExpiresAt = jwtExpiry(token) ?? Date.now() + 30 * 60_000;
  }

  private send(url: URL, token: string): Promise<Response> {
    return this.fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
  }
}

/** Pulls the row array and total out of whatever envelope Logiwa uses. */
export function toPage(body: unknown): Page {
  if (Array.isArray(body)) return { rows: body.filter(isRecord), total: null };
  if (!isRecord(body)) return { rows: [], total: null };
  for (const key of ['data', 'Data', 'items', 'Items', 'results', 'Results', 'result', 'Result']) {
    const v = body[key];
    if (Array.isArray(v)) return { rows: v.filter(isRecord), total: totalOf(body) ?? totalOf(v[0]) };
    if (isRecord(v)) {
      const inner = toPage(v);
      if (inner.rows.length || inner.total != null)
        return { rows: inner.rows, total: inner.total ?? totalOf(body) };
    }
  }
  return { rows: [], total: totalOf(body) };
}

/** Pulls one record out of a get-by-id response. */
export function toRecord(body: unknown): Record<string, unknown> | null {
  if (isRecord(body)) {
    for (const key of ['data', 'Data', 'result', 'Result']) {
      const v = body[key];
      if (isRecord(v)) return v;
      if (Array.isArray(v)) return v.find(isRecord) ?? null;
    }
    return body;
  }
  if (Array.isArray(body)) return body.find(isRecord) ?? null;
  return null;
}

function totalOf(v: unknown): number | null {
  if (!isRecord(v)) return null;
  for (const key of [
    'totalCount',
    'TotalCount',
    'recordCount',
    'RecordCount',
    'totalRecords',
    'total',
    'Total',
    'count',
  ]) {
    const n = v[key];
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

function jwtExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const exp = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 300);
  if (isRecord(body)) {
    const msg = body.message ?? body.Message ?? body.error ?? body.errors ?? body.Errors ?? body.title;
    if (msg != null) return (typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300);
  }
  return 'no details';
}
