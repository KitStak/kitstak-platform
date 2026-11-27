/**
 * Platform API tokens (`core.api_tokens`, drizzle/0012_core_api_tokens.sql; plan in
 * docs/integration/AGENT_WRITE_API.md W1 to W6).
 *
 * A token is `ks_pat_` plus 32 random bytes (base64url). Only its SHA-256 hash is stored, and the
 * token is returned once, when it is made. A token belongs to one person in one organization,
 * carries app scopes (`crm:read` to `pulse:write`; write implies read), always expires, and stops
 * working the moment it is revoked, its owner leaves or is deactivated in the organization, or the
 * owner is switched off (`core.sign_in_blocks`). It never grants more than the owner's own role:
 * the app that accepts it still runs its normal permission checks as that person.
 *
 * Raw `sql` over a structural executor (like `record-links.ts`), so Portal, CRM, Projects and Pulse
 * can all call it with their own driver or transaction.
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { isUuid, isoTimestampOf, pgErrorOf, queryFirst, queryRows, type Executor } from './programs/executor';
import { API_TOKEN_APPS, API_TOKEN_SCOPES, type ApiTokenApp, type ApiTokenScope } from './schema/core/api-tokens';

export { API_TOKEN_APPS, API_TOKEN_SCOPES, type ApiTokenApp, type ApiTokenScope } from './schema/core/api-tokens';
export type { Executor } from './programs/executor';

export const API_TOKEN_PREFIX = 'ks_pat_';
export const API_TOKEN_DEFAULT_DAYS = 30;
export const API_TOKEN_MAX_DAYS = 90;
/** Live (not revoked, not expired) tokens one person may hold in one organization. */
export const API_TOKEN_MAX_ACTIVE = 20;
export const API_TOKEN_NAME_MAX = 80;
/** Largest `target` an event may store, as JSON text. Larger targets are replaced by a note. */
export const API_TOKEN_EVENT_TARGET_MAX = 4096;
/** `last_used_at` is written at most once in this window per token. */
export const API_TOKEN_TOUCH_MS = 60_000;

const TOKEN_RE = /^ks_pat_[A-Za-z0-9_-]{43}$/;
const BEARER_RE = /^Bearer\s+(\S+)\s*$/i;
const DAY_MS = 86_400_000;
const DEACTIVATED = 'deactivated:%';

export type ApiTokenLevel = 'read' | 'write';
export type ApiTokenState = 'active' | 'expired' | 'revoked';
export type ApiTokenErrorCode = 'INVALID' | 'LIMIT' | 'NOT_FOUND' | 'UNAUTHENTICATED' | 'FORBIDDEN';
/** The input an INVALID error is about, so a form can put the message next to that field. */
export type ApiTokenErrorField = 'name' | 'scopes' | 'days';

/** Errors carry plain words people can read; the apps map `code` to their own HTTP status. */
export class ApiTokenError extends Error {
  constructor(
    readonly code: ApiTokenErrorCode,
    message: string,
    readonly field?: ApiTokenErrorField,
  ) {
    super(message);
    this.name = 'ApiTokenError';
  }
}

export interface ApiTokenSummary {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly ApiTokenScope[];
  readonly ownerId: string;
  readonly ownerName: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly state: ApiTokenState;
}

export interface ApiTokenPrincipal {
  readonly tokenId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly scopes: readonly ApiTokenScope[];
}

/* ===== pure ===== */

export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** What the screens show of a token: `ks_pat_` and four characters. */
export function tokenDisplayPrefix(token: string): string {
  return token.slice(0, API_TOKEN_PREFIX.length + 4);
}

/** The platform token in `Authorization: Bearer ks_pat_...`; null for anything else (CRM's `ks_live_` included). */
export function parseApiTokenBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = BEARER_RE.exec(header.trim());
  const token = match?.[1] ?? '';
  return TOKEN_RE.test(token) ? token : null;
}

/** Known scopes once each, in catalog order, with `app:read` added under every `app:write`. */
export function normalizeScopes(input: readonly string[]): ApiTokenScope[] {
  const known = new Set<string>(API_TOKEN_SCOPES);
  const unknown = input.filter((scope) => !known.has(scope));
  if (unknown.length > 0) throw new ApiTokenError('INVALID', `These are not token scopes: ${unknown.join(', ')}.`, 'scopes');
  const wanted = new Set(input);
  for (const app of API_TOKEN_APPS) if (wanted.has(`${app}:write`)) wanted.add(`${app}:read`);
  const scopes = API_TOKEN_SCOPES.filter((scope) => wanted.has(scope));
  if (scopes.length === 0) throw new ApiTokenError('INVALID', 'Pick at least one app for the token.', 'scopes');
  return scopes;
}

export function scopeAllows(scopes: readonly string[], app: ApiTokenApp, level: ApiTokenLevel): boolean {
  return scopes.includes(`${app}:write`) || (level === 'read' && scopes.includes(`${app}:read`));
}

export function expiresAtFor(days: number, now: Date = new Date()): Date {
  if (!Number.isInteger(days) || days < 1 || days > API_TOKEN_MAX_DAYS) {
    throw new ApiTokenError('INVALID', `A token lasts 1 to ${API_TOKEN_MAX_DAYS} days.`, 'days');
  }
  return new Date(now.getTime() + days * DAY_MS);
}

/** UI copy for a bad name, or null when it is fine. */
export function tokenNameIssue(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give the token a name.';
  if (trimmed.length > API_TOKEN_NAME_MAX) return `Use ${API_TOKEN_NAME_MAX} characters or fewer.`;
  return null;
}

export function tokenState(token: { readonly expiresAt: Date | string; readonly revokedAt: Date | string | null }, now: Date = new Date()): ApiTokenState {
  if (token.revokedAt) return 'revoked';
  const expires = token.expiresAt instanceof Date ? token.expiresAt.getTime() : Date.parse(token.expiresAt);
  return expires <= now.getTime() ? 'expired' : 'active';
}

/* ===== database ===== */

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[] | string;
  user_id: string;
  owner_name: string | null;
  created_at: unknown;
  expires_at: unknown;
  last_used_at: unknown;
  revoked_at: unknown;
}

/** node-postgres returns text[] as an array; some drivers return the `{a,b}` literal. */
function scopesOf(value: string[] | string): ApiTokenScope[] {
  const list = Array.isArray(value) ? value : value.replace(/^\{|\}$/g, '').split(',').filter((part) => part !== '');
  const known = new Set<string>(API_TOKEN_SCOPES);
  return list.filter((scope): scope is ApiTokenScope => known.has(scope));
}

function summaryOf(row: TokenRow, now: Date): ApiTokenSummary {
  const expiresAt = isoTimestampOf(row.expires_at) ?? '';
  const revokedAt = isoTimestampOf(row.revoked_at);
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    scopes: scopesOf(row.scopes),
    ownerId: row.user_id,
    ownerName: row.owner_name ?? 'Former member',
    createdAt: isoTimestampOf(row.created_at) ?? '',
    expiresAt,
    lastUsedAt: isoTimestampOf(row.last_used_at),
    revokedAt,
    state: tokenState({ expiresAt, revokedAt }, now),
  };
}

const TOKEN_COLUMNS = sql`t.id, t.name, t.token_prefix, t.scopes, t.user_id, u.name AS owner_name, t.created_at, t.expires_at, t.last_used_at, t.revoked_at`;

async function isActiveMember(db: Executor, orgId: string, userId: string): Promise<boolean> {
  const row = await queryFirst<{ ok: boolean }>(
    db,
    sql`SELECT true AS ok FROM core.member m
        WHERE m.organization_id = CAST(${orgId} AS uuid) AND m.user_id = CAST(${userId} AS uuid) AND m.role NOT LIKE ${DEACTIVATED}
        LIMIT 1`,
  );
  return row?.ok === true;
}

/**
 * Makes a token for a person in an organization they are an active member of. Returns the token
 * (shown once, never stored) and its summary. Callers check who may ask (Portal: the person
 * themselves, with a fresh sign in).
 *
 * The live token limit is checked here for a clear message, and enforced by the
 * `api_tokens_live_limit` trigger (0012), which locks per person so requests at the same moment
 * cannot pass it together. The insert returns the new row, so a token that was made is always
 * shown: there is no second read that could fail and leave a live token nobody saw.
 */
export async function createApiToken(
  db: Executor,
  input: { readonly orgId: string; readonly userId: string; readonly name: string; readonly scopes: readonly string[]; readonly days: number; readonly now?: Date },
): Promise<{ readonly token: string; readonly record: ApiTokenSummary }> {
  if (!isUuid(input.orgId) || !isUuid(input.userId)) throw new ApiTokenError('INVALID', 'The organization or person is not valid.');
  const nameIssue = tokenNameIssue(input.name);
  if (nameIssue) throw new ApiTokenError('INVALID', nameIssue, 'name');
  const scopes = normalizeScopes(input.scopes);
  const now = input.now ?? new Date();
  const expiresAt = expiresAtFor(input.days, now);
  const token = generateApiToken();
  const scopeArray = sql`ARRAY[${sql.join(
    scopes.map((scope) => sql`${scope}`),
    sql`, `,
  )}]::text[]`;

  let inserted: Omit<TokenRow, 'owner_name'> | undefined;
  try {
    inserted = await queryFirst<Omit<TokenRow, 'owner_name'>>(
    db,
    sql`INSERT INTO core.api_tokens (org_id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
        SELECT CAST(${input.orgId} AS uuid), CAST(${input.userId} AS uuid), ${input.name.trim()}, ${hashApiToken(token)}, ${tokenDisplayPrefix(token)},
               ${scopeArray}, CAST(${expiresAt.toISOString()} AS timestamptz), CAST(${now.toISOString()} AS timestamptz)
        WHERE EXISTS (
                SELECT 1 FROM core.member m
                WHERE m.organization_id = CAST(${input.orgId} AS uuid) AND m.user_id = CAST(${input.userId} AS uuid) AND m.role NOT LIKE ${DEACTIVATED})
          AND (SELECT count(*) FROM core.api_tokens c
               WHERE c.org_id = CAST(${input.orgId} AS uuid) AND c.user_id = CAST(${input.userId} AS uuid)
                 AND c.revoked_at IS NULL AND c.expires_at > CAST(${now.toISOString()} AS timestamptz)) < ${API_TOKEN_MAX_ACTIVE}
        RETURNING id, name, token_prefix, scopes, user_id, created_at, expires_at, last_used_at, revoked_at`,
    );
  } catch (error: unknown) {
    if (pgErrorOf(error)?.constraint === 'api_tokens_live_limit') throw limitError();
    throw error;
  }
  if (!inserted) {
    if (!(await isActiveMember(db, input.orgId, input.userId))) {
      throw new ApiTokenError('FORBIDDEN', 'Only active members of this organization can make a token here.');
    }
    throw limitError();
  }
  let ownerName: string | null = null;
  try {
    ownerName = (await queryFirst<{ name: string }>(db, sql`SELECT name FROM core."user" WHERE id = CAST(${input.userId} AS uuid)`))?.name ?? null;
  } catch {
    // Only the display name; the token itself is made and is returned below.
  }
  return { token, record: summaryOf({ ...inserted, owner_name: ownerName }, now) };
}

function limitError(): ApiTokenError {
  return new ApiTokenError('LIMIT', `You have ${API_TOKEN_MAX_ACTIVE} live tokens. Revoke one you no longer use first.`);
}

/** A person's own tokens in the organization, newest first; every member's when `includeOthers`. */
export async function listApiTokens(
  db: Executor,
  input: { readonly orgId: string; readonly userId: string; readonly includeOthers: boolean; readonly now?: Date },
): Promise<ApiTokenSummary[]> {
  if (!isUuid(input.orgId) || !isUuid(input.userId)) return [];
  const owner = input.includeOthers ? sql`true` : sql`t.user_id = CAST(${input.userId} AS uuid)`;
  const rows = await queryRows<TokenRow>(
    db,
    sql`SELECT ${TOKEN_COLUMNS} FROM core.api_tokens t LEFT JOIN core."user" u ON u.id = t.user_id
        WHERE t.org_id = CAST(${input.orgId} AS uuid) AND ${owner}
        ORDER BY t.created_at DESC, t.id`,
  );
  const now = input.now ?? new Date();
  return rows.map((row) => summaryOf(row, now));
}

/**
 * Revokes a token of the organization. The owner may revoke their own; a manager (org owner or admin,
 * decided by the caller) may revoke anyone's. Revoking an already revoked token is a no op.
 */
export async function revokeApiToken(
  db: Executor,
  input: { readonly orgId: string; readonly tokenId: string; readonly actorId: string; readonly actorIsManager: boolean },
): Promise<void> {
  const notFound = new ApiTokenError('NOT_FOUND', 'That token is not in this organization.');
  if (!isUuid(input.orgId) || !isUuid(input.tokenId) || !isUuid(input.actorId)) throw notFound;
  const allowed = input.actorIsManager ? sql`true` : sql`t.user_id = CAST(${input.actorId} AS uuid)`;
  const row = await queryFirst<{ id: string; revoked: boolean }>(
    db,
    sql`SELECT t.id, t.revoked_at IS NOT NULL AS revoked FROM core.api_tokens t
        WHERE t.id = CAST(${input.tokenId} AS uuid) AND t.org_id = CAST(${input.orgId} AS uuid) AND ${allowed}`,
  );
  if (!row) throw notFound;
  if (row.revoked) return;
  await db.execute(
    sql`UPDATE core.api_tokens SET revoked_at = now(), revoked_by = CAST(${input.actorId} AS uuid)
        WHERE id = CAST(${input.tokenId} AS uuid) AND org_id = CAST(${input.orgId} AS uuid) AND revoked_at IS NULL`,
  );
}

/**
 * Checks `Authorization: Bearer ks_pat_...` for one app and level. Throws UNAUTHENTICATED for a
 * missing, unknown, revoked or expired token, or an owner who is no longer an active member or is
 * switched off; FORBIDDEN when the token has no scope for the app and level. Every call reads the
 * database: there is no cache, so a revoke works on the next request.
 */
export async function authenticateApiToken(
  db: Executor,
  authorization: string | null | undefined,
  options: { readonly app: ApiTokenApp; readonly level: ApiTokenLevel; readonly now?: Date },
): Promise<ApiTokenPrincipal> {
  const token = parseApiTokenBearer(authorization);
  if (!token) throw new ApiTokenError('UNAUTHENTICATED', 'Send a KitStak API token as "Authorization: Bearer ks_pat_...".');
  const now = options.now ?? new Date();
  const row = await queryFirst<{ id: string; org_id: string; user_id: string; scopes: string[] | string; last_used_at: unknown }>(
    db,
    sql`SELECT t.id, t.org_id, t.user_id, t.scopes, t.last_used_at FROM core.api_tokens t
        WHERE t.token_hash = ${hashApiToken(token)} AND t.revoked_at IS NULL AND t.expires_at > CAST(${now.toISOString()} AS timestamptz)
          AND EXISTS (SELECT 1 FROM core.member m WHERE m.organization_id = t.org_id AND m.user_id = t.user_id AND m.role NOT LIKE ${DEACTIVATED})
          AND NOT EXISTS (SELECT 1 FROM core.sign_in_blocks b WHERE b.user_id = t.user_id)
        LIMIT 1`,
  );
  if (!row) throw new ApiTokenError('UNAUTHENTICATED', 'This API token is not valid, was revoked or has expired.');
  const scopes = scopesOf(row.scopes);
  if (!scopeAllows(scopes, options.app, options.level)) {
    throw new ApiTokenError('FORBIDDEN', `This token cannot ${options.level === 'write' ? 'change' : 'read'} ${options.app === 'crm' ? 'CRM' : options.app === 'projects' ? 'Projects' : 'Pulse'} data.`);
  }
  await touchLastUsed(db, row.id, row.last_used_at, now);
  return { tokenId: row.id, orgId: row.org_id, userId: row.user_id, scopes };
}

/**
 * Awaited on purpose (CRM learned this): a fire and forget UPDATE can be frozen mid query when a
 * serverless function suspends, and wedge the pooled connection. It is throttled, so it is cheap.
 * A failure never fails the request.
 */
async function touchLastUsed(db: Executor, tokenId: string, lastUsedAt: unknown, now: Date): Promise<void> {
  const last = isoTimestampOf(lastUsedAt);
  if (last && now.getTime() - Date.parse(last) < API_TOKEN_TOUCH_MS) return;
  try {
    await db.execute(
      sql`UPDATE core.api_tokens SET last_used_at = CAST(${now.toISOString()} AS timestamptz)
          WHERE id = CAST(${tokenId} AS uuid)
            AND (last_used_at IS NULL OR last_used_at < CAST(${new Date(now.getTime() - API_TOKEN_TOUCH_MS).toISOString()} AS timestamptz))`,
    );
  } catch {
    // Best effort: the request already passed every check.
  }
}

/**
 * One line in the token's log for a write an app accepted or refused. The token must be in `orgId`.
 * `target` is for record ids and counts only, never request bodies or secrets; a target larger than
 * `API_TOKEN_EVENT_TARGET_MAX` is stored as `{ "truncated": true }`.
 */
export async function recordApiTokenEvent(
  db: Executor,
  input: {
    readonly tokenId: string;
    readonly orgId: string;
    readonly app: ApiTokenApp;
    readonly action: string;
    readonly ok: boolean;
    readonly dryRun?: boolean;
    readonly errorCode?: string | null;
    readonly target?: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  if (!isUuid(input.tokenId) || !isUuid(input.orgId)) throw new ApiTokenError('NOT_FOUND', 'That token is not in this organization.');
  const targetText = JSON.stringify(input.target ?? {});
  const target = targetText.length > API_TOKEN_EVENT_TARGET_MAX ? '{"truncated":true}' : targetText;
  const errorCode = input.errorCode ? input.errorCode.slice(0, 80) : null;
  const row = await queryFirst<{ id: string }>(
    db,
    sql`INSERT INTO core.api_token_events (token_id, org_id, app, action, dry_run, ok, error_code, target)
        SELECT t.id, t.org_id, ${input.app}, ${input.action.slice(0, 120)}, ${input.dryRun === true}, ${input.ok}, ${errorCode},
               CAST(${target} AS jsonb)
        FROM core.api_tokens t WHERE t.id = CAST(${input.tokenId} AS uuid) AND t.org_id = CAST(${input.orgId} AS uuid)
        RETURNING id`,
  );
  if (!row) throw new ApiTokenError('NOT_FOUND', 'That token is not in this organization.');
}
