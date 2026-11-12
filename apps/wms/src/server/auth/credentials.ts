/**
 * Core identity + credential helpers (blueprint §1.4). Credentials no longer live in
 * `wms.users.password_hash`: the shared Better Auth tables are the source of truth —
 * `core."user"` (identity), `core.account` (`provider_id = 'credential'`, the password
 * hash), `core.member` (platform-org membership) and `wms.user_profiles` (WMS-only
 * identity columns). The WMS row id and the core user id are THE SAME uuid string, so
 * every `wms.*` FK keeps working and `SessionUser.id` is unchanged.
 *
 * New hashes are Better Auth scrypt; migrated/seeded bcrypt hashes verify through the
 * shared `passwordCompat` verifier (`$2a$/$2b$/$2y$` → bcryptjs).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { isBcryptHash } from '@kitstak/auth';
import { account, member, organization, passwordPolicyState, user, userProfiles } from '@kitstak/db/schema';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import bcrypt from 'bcryptjs';
import type { AppDb } from '@/server/api/db';
import { companySettings, users } from '@/server/db/schema';

export const PLATFORM_ORG_SLUG = 'kitstak';
export const CREDENTIAL_PROVIDER = 'credential';

export type WmsLegacyRole = (typeof users.$inferSelect)['role'];

/**
 * Org-role mapping (auth review 2026-11-11, H3): a WMS `admin` is a warehouse admin,
 * NOT a platform organization admin — org `admin` would grant Better Auth's
 * /api/auth/organization/* powers (invite arbitrary emails, update member roles,
 * remove members) on every app. Everyone maps to `member`/`viewer`; only an explicitly
 * chosen platform owner is ever given org owner/admin (done manually, never here).
 */
export function orgRoleForLegacy(role: WmsLegacyRole): 'member' | 'viewer' {
  return role === 'viewer' ? 'viewer' : 'member';
}

/** The one platform organization every WMS user belongs to (§2.4); created on demand. */
export async function ensurePlatformOrg(db: AppDb, now: Date = new Date()): Promise<string> {
  const existing = (
    await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, PLATFORM_ORG_SLUG))
      .limit(1)
  )[0];
  if (existing) return existing.id;
  const company = (
    await db.select({ displayName: companySettings.displayName }).from(companySettings).limit(1)
  )[0];
  const inserted = await db
    .insert(organization)
    .values({
      id: randomUUID(),
      name: company?.displayName ?? 'KitStak',
      slug: PLATFORM_ORG_SLUG,
      createdAt: now,
    })
    .onConflictDoNothing({ target: organization.slug })
    .returning({ id: organization.id });
  if (inserted[0]) return inserted[0].id;
  const raced = (
    await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, PLATFORM_ORG_SLUG))
      .limit(1)
  )[0];
  if (!raced) throw new Error('Could not create the platform organization');
  return raced.id;
}

export interface CoreIdentityInput {
  /** The wms.users id — MUST be a uuid string (core."user".id is uuid). */
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  /** Plaintext → hashed with the Better Auth default (scrypt). */
  readonly password?: string;
  /** Precomputed hash stored verbatim (seeds/migration pass bcrypt; compat verifies it). */
  readonly passwordHash?: string;
  readonly legacyRole: WmsLegacyRole;
  readonly userType: string;
  readonly isApiUser: boolean;
  readonly allClients: boolean;
  readonly preferences?: Record<string, unknown>;
  readonly passwordChangedAt?: Date | null;
  readonly createdAt?: Date;
}

/**
 * Creates (or refreshes) the full core identity for a WMS user: core."user" +
 * credential core.account + platform-org core.member + wms.user_profiles. Idempotent:
 * re-running (bootstrap, reseeding into a shared database) updates in place.
 */
export async function upsertCoreIdentity(db: AppDb, input: CoreIdentityInput): Promise<void> {
  const createdAt = input.createdAt ?? new Date();
  const email = input.email.trim().toLowerCase();
  const hash =
    input.passwordHash ?? (input.password !== undefined ? await hashPassword(input.password) : null);

  // Reseeding: a previous seed left a core identity under the same email with a different
  // id. Remove it (sessions/accounts/members/profile cascade) so the insert below wins.
  const emailClash = (
    await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  )[0];
  if (emailClash && emailClash.id !== input.userId) {
    await db.delete(user).where(eq(user.id, emailClash.id));
  }

  await db
    .insert(user)
    .values({
      id: input.userId,
      name: input.name,
      email,
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoUpdate({
      target: user.id,
      set: { name: input.name, email, updatedAt: new Date() },
    });

  if (hash !== null) {
    await db
      .delete(account)
      .where(and(eq(account.userId, input.userId), eq(account.providerId, CREDENTIAL_PROVIDER)));
    await db.insert(account).values({
      id: randomUUID(),
      accountId: input.userId,
      providerId: CREDENTIAL_PROVIDER,
      userId: input.userId,
      password: hash,
      createdAt,
      updatedAt: createdAt,
    });
  }

  const orgId = await ensurePlatformOrg(db, createdAt);
  const membership = (
    await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, input.userId)))
      .limit(1)
  )[0];
  const orgRole = orgRoleForLegacy(input.legacyRole);
  if (membership) {
    await db.update(member).set({ role: orgRole }).where(eq(member.id, membership.id));
  } else {
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: input.userId,
      role: orgRole,
      createdAt,
    });
  }

  await db
    .insert(userProfiles)
    .values({
      userId: input.userId,
      legacyRole: input.legacyRole,
      userType: input.userType,
      isApiUser: input.isApiUser,
      allClients: input.allClients,
      preferences: input.preferences ?? {},
      passwordChangedAt: input.passwordChangedAt ?? null,
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        legacyRole: input.legacyRole,
        userType: input.userType,
        isApiUser: input.isApiUser,
        allClients: input.allClients,
        ...(input.passwordChangedAt !== undefined ? { passwordChangedAt: input.passwordChangedAt } : {}),
      },
    });
}

/** Keeps core."user" name/email in sync with a wms.users edit. */
export async function syncCoreUser(
  db: AppDb,
  userId: string,
  fields: { readonly email?: string; readonly name?: string },
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (fields.email !== undefined) set.email = fields.email.trim().toLowerCase();
  if (fields.name !== undefined) set.name = fields.name;
  await db.update(user).set(set).where(eq(user.id, userId));
}

/** Verifies a password against the core credential account (bcrypt-compat aware). */
export async function verifyCredentialPassword(
  db: AppDb,
  userId: string,
  password: string,
): Promise<boolean> {
  const row = (
    await db
      .select({ password: account.password })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, CREDENTIAL_PROVIDER)))
      .limit(1)
  )[0];
  if (!row?.password) return false;
  if (isBcryptHash(row.password)) {
    try {
      return await bcrypt.compare(password, row.password);
    } catch {
      return false;
    }
  }
  return await verifyPassword({ hash: row.password, password });
}

/**
 * Sets a new credential password (Better Auth scrypt), stamps the WMS profile and
 * clears any lockout. `passwordChangedAt: null` marks the password as expired
 * (admin reset → forced change).
 */
export async function setCredentialPassword(
  db: AppDb,
  userId: string,
  password: string,
  options: { readonly passwordChangedAt?: Date | null } = {},
  now: Date = new Date(),
): Promise<void> {
  const hash = await hashPassword(password);
  const existing = (
    await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, CREDENTIAL_PROVIDER)))
      .limit(1)
  )[0];
  if (existing) {
    await db.update(account).set({ password: hash, updatedAt: now }).where(eq(account.id, existing.id));
  } else {
    await db.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER,
      userId,
      password: hash,
      createdAt: now,
      updatedAt: now,
    });
  }
  const changedAt = options.passwordChangedAt === undefined ? now : options.passwordChangedAt;
  await db.update(userProfiles).set({ passwordChangedAt: changedAt }).where(eq(userProfiles.userId, userId));
  const legacy = (
    await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (legacy) await clearLockoutState(db, legacy.email);
}

/**
 * Deletes the credential `core.account` row (auth review 2026-11-11, H3): the shared
 * tables have no banned/active column Better Auth checks, so removing the credential is
 * what makes password sign-in die on EVERY instance (CRM included) when WMS deactivates
 * a user. Reactivation deliberately does NOT restore it — the admin password-reset flow
 * (`resetUserPassword` → `setCredentialPassword`) issues the new credential.
 */
export async function deleteCredentialAccount(db: AppDb, userId: string): Promise<boolean> {
  const removed = await db
    .delete(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, CREDENTIAL_PROVIDER)))
    .returning({ id: account.id });
  return removed.length > 0;
}

/** Clears the password-policy plugin's lockout row for an email. */
export async function clearLockoutState(db: AppDb, email: string): Promise<void> {
  await db.delete(passwordPolicyState).where(eq(passwordPolicyState.email, email.trim().toLowerCase()));
}
