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
 *
 * One separate warehouse per organization: after Better Auth validates the session (core
 * tables, platform handle), the request's org is picked (src/server/tenancy/registry.ts —
 * org-switcher cookie, active org, platform org, first) and the WMS profile/user rows are read
 * from THAT org's warehouse schema. `SessionUser` carries the org and its schema; every
 * downstream query uses that tenant's handle.
 */
import { and, eq, gt } from 'drizzle-orm';
import { session as coreSession, userProfiles } from '@kitstak/db/schema';
import { desc } from '@/server/db/order';
import { users } from '@/server/db/schema';
import { WMS_PLATFORM_SCHEMA } from '@kitstak/db/wms-tenants';
import { getTenantDbFor, type AppDb } from '@/server/api/db';
import {
  listWmsOrgs,
  openableOrgs,
  rankWmsOrgs,
  setupCandidates,
  WMS_ORG_COOKIE,
  type WmsOrgChoice,
} from '@/server/tenancy/registry';
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
  /** The organization whose warehouse this request works in. */
  readonly orgId: string;
  readonly orgName: string;
  readonly orgSlug: string;
  /** That org's WMS schema (`wms` for the platform org). */
  readonly tenantSchema: string;
}

/** `no_warehouse`: signed in, but none of the user's orgs has a WMS warehouse yet. */
export type SessionRejectReason = 'unauthenticated' | 'user_inactive' | 'no_profile' | 'no_warehouse';

/** An entitled org without a warehouse the signed-in user may set up (owner/admin). */
export interface WarehouseSetupOffer {
  readonly orgId: string;
  readonly orgName: string;
}

export type SessionResolution =
  | { readonly ok: true; readonly user: SessionUser }
  | {
      readonly ok: false;
      readonly reason: SessionRejectReason;
      /** With `no_warehouse` / `no_profile`: orgs the user could set up a warehouse for. */
      readonly setup?: readonly WarehouseSetupOffer[];
    };

/** Reads one cookie from a raw Cookie header. */
function cookieFrom(headers: Headers, name: string): string | null {
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('=')) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/**
 * Verifies the request's Better Auth session, picks the org (warehouse) and loads the WMS
 * identity columns from it. `db` is the PLATFORM handle. Never throws for bad/missing cookies.
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

  const choices = await listWmsOrgs(db, resolved.user.id);
  const ranked = rankWmsOrgs(choices, {
    cookieOrgId: cookieFrom(headers, WMS_ORG_COOKIE),
    activeOrgId: (resolved.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
  });
  const offers = setupCandidates(choices).map((c) => ({ orgId: c.orgId, orgName: c.name }));
  // Setup offers ride along only when there are some (callers compare results exactly).
  const setup = offers.length > 0 ? { setup: offers } : {};
  if (ranked.length === 0) return { ok: false, reason: 'no_warehouse', ...setup };

  // Membership alone is not access: walk the ranked warehouses until one holds an active
  // profile for this user (a stale switcher cookie must never lock them out of the others).
  let firstFailure: SessionRejectReason | null = null;
  for (const org of ranked) {
    const schemaName = org.schemaName as string;
    const access = await loadWarehouseAccess(db, schemaName, resolved.user.id);
    if (!access.ok) {
      firstFailure ??= access.reason;
      continue;
    }
    return {
      ok: true,
      user: {
        id: resolved.user.id,
        email: resolved.user.email,
        name: resolved.user.name,
        role: access.role,
        userType: access.userType,
        allClients: access.allClients,
        isApiUser: access.isApiUser,
        sessionId: resolved.session.id,
        sessionVersion: 1,
        sessionExpiresAt: toIso(resolved.session.expiresAt),
        orgId: org.orgId,
        orgName: org.name,
        orgSlug: org.slug,
        tenantSchema: schemaName,
      },
    };
  }
  if (firstFailure === 'user_inactive') return { ok: false, reason: 'user_inactive' };
  return { ok: false, reason: 'no_profile', ...setup };
}

type WarehouseAccess =
  | {
      readonly ok: true;
      readonly role: LegacyRole;
      readonly userType: UserType;
      readonly allClients: boolean;
      readonly isApiUser: boolean;
    }
  | { readonly ok: false; readonly reason: 'user_inactive' | 'no_profile' };

/**
 * Whether a user may work in one warehouse: an ACTIVE `users` row (if any) and a
 * `user_profiles` row in that schema. `platformDb` serves the platform schema itself.
 */
export async function loadWarehouseAccess(
  platformDb: AppDb,
  schemaName: string,
  userId: string,
  tenantDb: (schemaName: string) => Promise<AppDb> = getTenantDbFor,
): Promise<WarehouseAccess> {
  const tdb = schemaName === WMS_PLATFORM_SCHEMA ? platformDb : await tenantDb(schemaName);
  const [profile] = await tdb
    .select({
      legacyRole: userProfiles.legacyRole,
      userType: userProfiles.userType,
      isApiUser: userProfiles.isApiUser,
      allClients: userProfiles.allClients,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  const [legacy] = await tdb
    .select({ isActive: users.isActive, userType: users.userType })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (legacy && !legacy.isActive) return { ok: false, reason: 'user_inactive' };
  // No user_profiles row (e.g. a CRM-only platform user): EXPLICIT DENY (auth review
  // 2026-11-11, C1). A shared-session identity without a WMS profile gets zero WMS access —
  // never viewer defaults, which exposed every viewer-visible screen to any core user.
  if (!profile) return { ok: false, reason: 'no_profile' };
  return {
    ok: true,
    role: profile.legacyRole as LegacyRole,
    userType: (profile.userType ?? legacy?.userType ?? 'Operation') as UserType,
    allClients: profile.allClients,
    isApiUser: profile.isApiUser,
  };
}

/** Openable warehouses (member, entitled, active) where the user also has active access. */
export async function accessibleWmsOrgs(platformDb: AppDb, userId: string): Promise<WmsOrgChoice[]> {
  const open = openableOrgs(await listWmsOrgs(platformDb, userId));
  const allowed: WmsOrgChoice[] = [];
  for (const org of open)
    if ((await loadWarehouseAccess(platformDb, org.schemaName as string, userId)).ok) allowed.push(org);
  return allowed;
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
