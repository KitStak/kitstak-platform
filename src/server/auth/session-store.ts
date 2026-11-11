/**
 * Session persistence + verification core (framework-free, DB-injected, unit-testable).
 *
 * A session is a `user_sessions` row whose id is the JWT `jti`. The signed JWT carries
 * `sub` (user id), `jti` and `sv` (the user's `session_version` at issue time).
 * A token is accepted only when ALL of these hold:
 *   - signature + `exp` valid (12 h absolute TTL);
 *   - the row exists, belongs to `sub`, is not revoked and not expired;
 *   - `sv` == row.session_version == users.session_version;
 *   - the user is active.
 * Bumping `users.session_version` (deactivation, role change, password change) therefore
 * kills every open session on the next request.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { desc } from "@/server/db/order";
import { SignJWT, jwtVerify } from "jose";
import { users, userSessions } from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { log } from "@/server/log";
import { bestEffort, rowCount } from "@/server/db/sql";

export const SESSION_TTL_SECONDS = 12 * 60 * 60;
/** `last_seen_at` is only rewritten when older than this, to avoid a write per request. */
export const LAST_SEEN_RESOLUTION_MS = 60_000;
const JWT_ALG = "HS256";
const MIN_SECRET_LENGTH = 32;

export type LegacyRole = (typeof users.$inferSelect)["role"];
export type UserType = (typeof users.$inferSelect)["userType"];

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

export interface SessionMeta {
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface IssuedSession {
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly maxAgeSeconds: number;
}

export type SessionRejectReason =
  | "malformed"
  | "invalid_token"
  | "unknown_session"
  | "revoked"
  | "expired"
  | "user_inactive"
  | "version_mismatch";

export type SessionResolution =
  | { readonly ok: true; readonly user: SessionUser }
  | { readonly ok: false; readonly reason: SessionRejectReason };

let warnedMissingSecret = false;

/** HS256 key from SESSION_SECRET. Fatal in production when missing/short. */
export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return new TextEncoder().encode(secret);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not configured (min 32 chars). Set it in the environment.");
  }
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    log.warn("SESSION_SECRET missing — using an insecure dev-only derived secret", { component: "auth" });
  }
  return new TextEncoder().encode(createHash("sha256").update("kitstak-dev-fallback-session-secret").digest("hex"));
}

/** Creates the `user_sessions` row and signs the JWT. The user must exist and be active. */
export async function issueSession(
  db: AppDb,
  userId: string,
  meta: SessionMeta = {},
  now: Date = new Date(),
): Promise<IssuedSession> {
  const [user] = await db
    .select({ id: users.id, isActive: users.isActive, sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || !user.isActive) throw new Error("Cannot issue a session for a missing or inactive user");

  const sessionId = randomUUID();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.insert(userSessions)
    .values({
      id: sessionId,
      userId,
      sessionVersion: user.sessionVersion,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 400) : null,
    });

  const issuedAt = Math.floor(now.getTime() / 1000);
  const token = await new SignJWT({ sv: user.sessionVersion })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
    .sign(getSessionSecret());

  return { token, sessionId, expiresAt, maxAgeSeconds: SESSION_TTL_SECONDS };
}

interface TokenClaims {
  readonly sub: string;
  readonly jti: string;
  readonly sv: number;
}

async function verifyToken(token: string, now: Date): Promise<TokenClaims | SessionRejectReason> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), { algorithms: [JWT_ALG], currentDate: now });
    const { sub, jti, sv } = payload as { sub?: unknown; jti?: unknown; sv?: unknown };
    if (typeof sub !== "string" || typeof jti !== "string" || typeof sv !== "number") return "malformed";
    return { sub, jti, sv };
  } catch {
    return "invalid_token";
  }
}

/** Verifies a session token against the database. Never throws for bad tokens. */
export async function resolveSession(db: AppDb, token: string, now: Date = new Date()): Promise<SessionResolution> {
  if (!token) return { ok: false, reason: "malformed" };
  const claims = await verifyToken(token, now);
  if (typeof claims === "string") return { ok: false, reason: claims };

  const [row] = await db
    .select({ session: userSessions, user: users })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(eq(userSessions.id, claims.jti))
    .limit(1);
  if (!row || row.session.userId !== claims.sub) return { ok: false, reason: "unknown_session" };
  const { session, user } = row;
  if (session.revokedAt) return { ok: false, reason: "revoked" };
  if (session.expiresAt <= now.toISOString()) return { ok: false, reason: "expired" };
  if (!user.isActive) return { ok: false, reason: "user_inactive" };
  if (claims.sv !== session.sessionVersion || claims.sv !== user.sessionVersion) {
    return { ok: false, reason: "version_mismatch" };
  }

  await touchLastSeen(db, session.id, session.lastSeenAt, now);
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      userType: user.userType,
      allClients: user.allClients,
      isApiUser: user.isApiUser,
      sessionId: session.id,
      sessionVersion: session.sessionVersion,
      sessionExpiresAt: session.expiresAt,
    },
  };
}

async function touchLastSeen(db: AppDb, sessionId: string, lastSeenAt: string | null, now: Date): Promise<void> {
  const stale = !lastSeenAt || now.getTime() - Date.parse(lastSeenAt) >= LAST_SEEN_RESOLUTION_MS;
  if (!stale) return;
  // Best effort (savepoint): a busy DB must not log the user out or abort an enclosing transaction.
  const result = await bestEffort(db, async (sp) => {
    await sp.update(userSessions).set({ lastSeenAt: now.toISOString() }).where(eq(userSessions.id, sessionId));
  });
  if (!result.ok) log.warn("session lastSeenAt update failed", { component: "auth", err: result.error });
}

/** Revokes one session. Returns true when a live row was revoked. */
export async function revokeSession(db: AppDb, sessionId: string, now: Date = new Date()): Promise<boolean> {
  const res = await db
    .update(userSessions)
    .set({ revokedAt: now.toISOString() })
    .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)));
  return rowCount(res) > 0;
}

/** Revokes every live session of a user, optionally keeping one (the caller's). */
export async function revokeUserSessions(
  db: AppDb,
  userId: string,
  options: { readonly exceptSessionId?: string } = {},
  now: Date = new Date(),
): Promise<number> {
  const conditions = [eq(userSessions.userId, userId), isNull(userSessions.revokedAt)];
  const where = options.exceptSessionId
    ? and(...conditions, ne(userSessions.id, options.exceptSessionId))
    : and(...conditions);
  return rowCount(await db.update(userSessions).set({ revokedAt: now.toISOString() }).where(where));
}

/**
 * Increments `users.session_version` and revokes all sessions. Call on deactivation,
 * role change and password change. Returns the new version.
 */
export async function bumpSessionVersion(db: AppDb, userId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: now.toISOString() })
    .where(eq(users.id, userId))
    .returning({ sessionVersion: users.sessionVersion });
  if (!row) throw new Error(`User ${userId} not found`);
  await revokeUserSessions(db, userId, {}, now);
  return row.sessionVersion;
}

export interface SessionSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly expiresAt: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Live (not revoked, not expired) sessions of a user, newest first. */
export async function listActiveSessions(db: AppDb, userId: string, now: Date = new Date()): Promise<readonly SessionSummary[]> {
  return db
    .select({
      id: userSessions.id,
      createdAt: userSessions.createdAt,
      lastSeenAt: userSessions.lastSeenAt,
      expiresAt: userSessions.expiresAt,
      ip: userSessions.ip,
      userAgent: userSessions.userAgent,
    })
    .from(userSessions)
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, now.toISOString())))
    .orderBy(desc(userSessions.createdAt));
}

/** Deletes rows that expired or were revoked more than `graceDays` ago. */
export async function purgeStaleSessions(db: AppDb, now: Date = new Date(), graceDays = 7): Promise<number> {
  const cutoff = new Date(now.getTime() - graceDays * 86_400_000).toISOString();
  return rowCount(await db
    .delete(userSessions)
    .where(or(lt(userSessions.expiresAt, cutoff), lt(userSessions.revokedAt, cutoff))));
}
