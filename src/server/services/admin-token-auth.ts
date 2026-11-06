/**
 * Bearer authentication for personal API tokens (`Authorization: Bearer ks_live_…`).
 *
 * Looks the SHA-256 hash up in `api_tokens` (not revoked, not expired), loads the owner, and
 * returns a session-shaped principal plus the token's org and scopes. `withApi` then requires
 * the request's org to be the token's org and the route permission to be covered by both the
 * owner's role and the token's scopes. `last_used_at` is written at most once a minute.
 */
import 'server-only';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Session } from '@/server/auth/session';
import { db } from '@/server/db';
import { apiTokens, user } from '@/server/db/schema';
import { UnauthenticatedError } from '@/server/http/errors';
import { logger } from '@/server/logger';
import { hashToken } from './admin-security';
import { parseBearerToken, shouldTouchLastUsed, TOKEN_LAST_USED_THROTTLE_MS } from './admin-token-scopes';

export interface TokenPrincipal {
  readonly session: Session;
  readonly tokenId: string;
  readonly orgId: string;
  readonly scopes: readonly string[];
}

/** True when the request carries an `Authorization: Bearer` header (valid or not). */
export function hasBearerHeader(headers: Headers): boolean {
  return /^Bearer\s/i.test(headers.get('authorization')?.trim() ?? '');
}

/**
 * Resolve a bearer token. Returns null when no bearer header is present; throws
 * UnauthenticatedError for malformed, unknown, revoked or expired tokens.
 */
export async function authenticateApiToken(headers: Headers): Promise<TokenPrincipal | null> {
  if (!hasBearerHeader(headers)) return null;
  const raw = parseBearerToken(headers.get('authorization'));
  if (!raw) throw new UnauthenticatedError('Invalid API token');
  const now = new Date();
  const [row] = await db
    .select({ token: apiTokens, owner: user })
    .from(apiTokens)
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(raw)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .limit(1);
  if (!row) throw new UnauthenticatedError('Invalid, revoked or expired API token');

  if (shouldTouchLastUsed(row.token.lastUsedAt, now.getTime())) {
    const cutoff = new Date(now.getTime() - TOKEN_LAST_USED_THROTTLE_MS);
    void db
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiTokens.id, row.token.id),
          or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, cutoff)),
        ),
      )
      .catch((error: unknown) => logger.warn('api_token.touch_failed', { tokenId: row.token.id, error }));
  }

  const session = {
    user: row.owner,
    session: {
      id: `api_token:${row.token.id}`,
      token: '',
      userId: row.owner.id,
      createdAt: row.token.createdAt,
      updatedAt: now,
      expiresAt: row.token.expiresAt ?? new Date(now.getTime() + 3_600_000),
      ipAddress: null,
      userAgent: headers.get('user-agent'),
      activeOrganizationId: row.token.orgId,
      activeTeamId: null,
    },
  } as unknown as Session;

  return { session, tokenId: row.token.id, orgId: row.token.orgId, scopes: row.token.scopes };
}
