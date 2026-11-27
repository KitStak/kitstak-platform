/**
 * Environment configuration. Every variable is prefixed KITSTAK_MCP_ so the server never
 * picks up an app's DATABASE_URL (which is a read-write connection) by accident.
 */

export interface Config {
  /** Postgres connection string for the read-only role (see sql/readonly-role.sql). */
  readonly databaseUrl: string;
  /** Organization slug or uuid: the one org (and its WMS warehouse) this server reads. */
  readonly org: string;
  /** Optional client codes to narrow every tool to; empty means all clients of the org. */
  readonly clientCodes: readonly string[];
  /** Default row limit for list tools (hard cap 200). */
  readonly defaultLimit: number;
  /** Include private/shareable CRM boards, closed workspaces and private projects. */
  readonly includePrivate: boolean;
  /** Escape hatch for local testing only: run even if the role can write. */
  readonly allowWriteRole: boolean;
}

export const MAX_LIMIT = 200;

type Env = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Env = process.env): Config {
  const databaseUrl = env.KITSTAK_MCP_DATABASE_URL?.trim();
  const org = env.KITSTAK_MCP_ORG?.trim();
  const missing = [!databaseUrl && 'KITSTAK_MCP_DATABASE_URL', !org && 'KITSTAK_MCP_ORG'].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}. See .env.example.`);
  }
  const clientCodes = (env.KITSTAK_MCP_CLIENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const limit = Number(env.KITSTAK_MCP_DEFAULT_LIMIT);
  const defaultLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : 50;
  return {
    databaseUrl: databaseUrl!,
    org: org!,
    clientCodes,
    defaultLimit,
    includePrivate: env.KITSTAK_MCP_INCLUDE_PRIVATE === '1',
    allowWriteRole: env.KITSTAK_MCP_ALLOW_WRITE_ROLE === '1',
  };
}
