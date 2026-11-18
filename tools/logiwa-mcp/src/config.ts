/**
 * Environment configuration. Every variable is prefixed LOGIWA_MCP_ so the server never picks up
 * another script's Logiwa credentials (for example a Logiwa Classic session cookie) by accident.
 */

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_BASE_URL = 'https://myapi.logiwa.com';

export type Auth =
  | { readonly kind: 'password'; readonly email: string; readonly password: string }
  | { readonly kind: 'token'; readonly token: string };

export interface Config {
  readonly baseUrl: string;
  readonly auth: Auth;
  /** Client identifiers every tool is narrowed to; empty means all clients the API user can see. */
  readonly clients: readonly string[];
  readonly pageSize: number;
  readonly timeoutMs: number;
  /** Send filters to Logiwa as query parameters (rows are always filtered locally as well). */
  readonly serverFilters: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function loadConfig(env: Env = process.env): Config {
  const token = env.LOGIWA_MCP_TOKEN?.trim();
  const email = env.LOGIWA_MCP_EMAIL?.trim();
  const password = env.LOGIWA_MCP_PASSWORD ?? '';

  let auth: Auth;
  if (token) {
    auth = { kind: 'token', token };
  } else if (email && password) {
    auth = { kind: 'password', email, password };
  } else {
    throw new Error(
      'No Logiwa credentials. Set LOGIWA_MCP_EMAIL and LOGIWA_MCP_PASSWORD (API user), or LOGIWA_MCP_TOKEN. See .env.example.',
    );
  }

  const rawBase = env.LOGIWA_MCP_BASE_URL?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    throw new Error(`LOGIWA_MCP_BASE_URL is not a valid URL: ${rawBase}`);
  }
  // Credentials and tokens only ever travel over https (plain http is allowed for a local mock only).
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error('LOGIWA_MCP_BASE_URL must use https.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('LOGIWA_MCP_BASE_URL must be a plain host, with no credentials, query or fragment.');
  }

  const clients = (env.LOGIWA_MCP_CLIENTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const size = Number(env.LOGIWA_MCP_PAGE_SIZE);
  const timeout = Number(env.LOGIWA_MCP_TIMEOUT_MS);

  return {
    baseUrl: url.origin + url.pathname.replace(/\/+$/, ''),
    auth,
    clients,
    pageSize: Number.isInteger(size) && size > 0 ? Math.min(size, MAX_PAGE_SIZE) : 50,
    timeoutMs: Number.isInteger(timeout) && timeout > 0 ? timeout : 30_000,
    serverFilters: env.LOGIWA_MCP_SERVER_FILTERS !== '0',
  };
}
