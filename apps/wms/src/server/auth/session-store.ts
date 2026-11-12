/**
 * Session verification + management over the shared Better Auth tables (blueprint §1.4).
 *
 * `resolveSession()` is THE seam: it asks the shared Better Auth instance to validate
 * the `kitstak.session_token` cookie (DB-backed `core.session`, cookie cache bypassed so
 * revocation/deactivation bite on the next request) and adapts the result to the
 * existing `SessionUser` shape every `defineRoute()` handler and page consumes:
 * `role/userType/allClients/isApiUser` come from `wms.user_profiles` (§2.4),
 * `sessionId` is the Better Auth session id, `sessionVersion` is pinned to 1 (the
 * version-bump mechanism is replaced by revoking `core.session` rows — see
 * `bumpSessionVersion`, kept as the §1.2 call-site seam).
 *
 * The legacy `wms.users` row still carries `is_active` (admin module), so an inactive
 * user is rejected here even while their Better Auth session row exists.
 */
import { and, eq, gt } from 'drizzle-orm';
import { session as coreSession, userProfiles } from '@kitstak/db/schema';
import { desc } from '@/server/db/order';
import { users } from '@/server/db/schema';
import type { AppDb } from '@/server/api/db';
import { getWmsAuth } from './auth';

export type LegacyRole = (typeof users.$inferSelect)['role'];
export type UserType = (typeof users.$inferSelect)['userType'];

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /** Legacy coarse role; fine-grained access comes from the permission catalog. */
  readonly role: LegacyRole;
  readonly userType: UserType;
  readonly allClients: boolean;
  readonly isApiUser: boolean;
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly sessionExpiresAt: string;
}

export type SessionRejectReason = 'unauthenticated' | 'user_inactive' | 'no_profile';

export type SessionResolution =
  | { readonly ok: true; readonly user: SessionUser }
  | { readonly ok: false; readonly reason: SessionRejectReason };

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/**
 * Verifies the request's Better Auth session and loads the WMS identity columns.
 * Never throws for bad/missing cookies.
 */
export async function resolveSession(db: AppDb, headers: Headers): Promise<SessionResolution> {
  const auth = await getWmsAuth();
  let resolved: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    resolved = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
  } catch {
    return { ok: false, reason: 'unauthenticated' };
  }
  if (!resolved) return { ok: false, reason: 'unauthenticated' };

  const [profile] = await db
    .select({
      legacyRole: userProfiles.legacyRole,
      userType: userProfiles.userType,
      isApiUser: userProfiles.isApiUser,
      allClients: userProfiles.allClients,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, resolved.user.id))
    .limit(1);
  const [legacy] = await db
    .select({ isActive: users.isActive, role: users.role, userType: users.userType })
    .from(users)
    .where(eq(users.id, resolved.user.id))
    .limit(1);
  if (legacy && !legacy.isActive) return { ok: false, reason: 'user_inactive' };

  // No profile row (e.g. a CRM-only platform user): minimum-privilege viewer defaults.
  const role = (profile?.legacyRole ?? 'viewer') as LegacyRole;
  const userType = (profile?.userType ?? legacy?.userType ?? 'Operation') as UserType;
  return {
    ok: true,
    user: {
      id: resolved.user.id,
      email: resolved.user.email,
      name: resolved.user.name,
      role,
      userType,
      allClients: profile?.allClients ?? false,
      isApiUser: profile?.isApiUser ?? false,
      sessionId: resolved.session.id,
      sessionVersion: 1,
      sessionExpiresAt: toIso(resolved.session.expiresAt),
    },
  };
}

/** Revokes (deletes) one Better Auth session row. True when a live row was removed. */
export async function revokeSession(db: AppDb, sessionId: string): Promise<boolean> {
  const removed = await db
    .delete(coreSession)
    .where(eq(coreSession.id, sessionId))
    .returning({ id: coreSession.id });
  return removed.length > 0;
}

/** Revokes every session of a user, optionally keeping one (the caller's). */
export async function revokeUserSessions(
  db: AppDb,
  userId: string,
  options: { readonly exceptSessionId?: string } = {},
): Promise<number> {
  const rows = await db
    .select({ id: coreSession.id })
    .from(coreSession)
    .where(eq(coreSession.userId, userId));
  const ids = rows.map((r) => r.id).filter((id) => id !== options.exceptSessionId);
  let revoked = 0;
  for (const id of ids) if (await revokeSession(db, id)) revoked += 1;
  return revoked;
}

/**
 * Legacy name kept at the §1.2 call sites (password change, admin access change,
 * deactivation): with Better Auth there is no session_version — ending every session of
 * the user IS the semantics. Returns the number of sessions revoked.
 */
export async function bumpSessionVersion(db: AppDb, userId: string, _now: Date = new Date()): Promise<number> {
  return await revokeUserSessions(db, userId);
}

export interface SessionSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly expiresAt: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Live (unexpired) sessions of a user, newest first (`lastSeenAt` = Better Auth updatedAt). */
export async function listActiveSessions(
  db: AppDb,
  userId: string,
  now: Date = new Date(),
): Promise<readonly SessionSummary[]> {
  const rows = await db
    .select({
      id: coreSession.id,
      createdAt: coreSession.createdAt,
      updatedAt: coreSession.updatedAt,
      expiresAt: coreSession.expiresAt,
      ip: coreSession.ipAddress,
      userAgent: coreSession.userAgent,
    })
    .from(coreSession)
    .where(and(eq(coreSession.userId, userId), gt(coreSession.expiresAt, now)))
    .orderBy(desc(coreSession.createdAt));
  return rows.map((row) => ({
    id: row.id,
    createdAt: toIso(row.createdAt),
    lastSeenAt: row.updatedAt ? toIso(row.updatedAt) : null,
    expiresAt: toIso(row.expiresAt),
    ip: row.ip,
    userAgent: row.userAgent,
  }));
}
