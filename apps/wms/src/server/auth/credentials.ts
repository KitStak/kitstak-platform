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
import { and, eq, ne } from 'drizzle-orm';
import { isBcryptHash } from '@kitstak/auth';
import { account, member, organization, passwordPolicyState, user, userProfiles } from '@kitstak/db/schema';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import bcrypt from 'bcryptjs';
import { WMS_PLATFORM_SCHEMA } from '@kitstak/db/wms-tenants';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import { companySettings, users } from '@/server/db/schema';
import { currentWmsSchema } from '@/server/db/tenant';
import { orgIdForDb, registerPlatformTenant } from '@/server/tenancy/registry';

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

/**
 * The platform organization (slug `kitstak`) — owner of the original `wms` schema; created on
 * demand and registered in core.wms_tenants. Other orgs have their own warehouse schemas: use
 * `warehouseOrgId(db)` for "the org this handle's warehouse belongs to".
 */
export async function ensurePlatformOrg(db: AppDb, now: Date = new Date()): Promise<string> {
  const orgId = await findOrCreatePlatformOrg(db, now);
  await registerPlatformTenant(db, orgId);
  return orgId;
}

/**
 * The organization owning the warehouse `db` reads/writes: the platform org for `wms`, the
 * registered org for a tenant schema. Throws for an unregistered tenant schema.
 */
export async function warehouseOrgId(db: AppDb, now: Date = new Date()): Promise<string> {
  const schemaName = await currentWmsSchema(db);
  if (schemaName === WMS_PLATFORM_SCHEMA) return await ensurePlatformOrg(db, now);
  const orgId = await orgIdForDb(db);
  if (!orgId) throw new Error(`Warehouse schema ${schemaName} is not registered to an organization`);
  return orgId;
}

async function findOrCreatePlatformOrg(db: AppDb, now: Date): Promise<string> {
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

/** Org roles a WMS edit must never overwrite (they are granted in the portal, not here). */
const PRESERVED_ORG_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

/**
 * True when the core identity belongs to NO organization other than the one owning this
 * warehouse. Only then may a WMS admin change its password, email or credential, delete it,
 * or end its sessions everywhere: core identities are shared platform-wide, and one org's
 * warehouse admin must never be able to take over or lock out a member of another org.
 */
export async function identityManagedHere(db: AppDb, userId: string): Promise<boolean> {
  const orgId = await warehouseOrgId(db);
  const other = (
    await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), ne(member.organizationId, orgId)))
      .limit(1)
  )[0];
  return !other;
}

/** Throws INVALID_STATE unless `identityManagedHere` (see there). */
export async function assertIdentityManagedHere(db: AppDb, userId: string, action: string): Promise<void> {
  if (await identityManagedHere(db, userId)) return;
  throw new AppError(
    'INVALID_STATE',
    `This person's KitStak account is shared with another organization, so you cannot ${action} from this warehouse. They manage it themselves.`,
  );
}

/** The core user id registered under an email, or null. */
export async function findCoreUserIdByEmail(db: AppDb, email: string): Promise<string | null> {
  const row = (
    await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .limit(1)
  )[0];
  return row?.id ?? null;
}

/** Whether a core user is a member of the organization owning this warehouse. */
export async function isWarehouseOrgMember(db: AppDb, userId: string): Promise<boolean> {
  const orgId = await warehouseOrgId(db);
  const row = (
    await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
      .limit(1)
  )[0];
  return Boolean(row);
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
  /**
   * Seed/bootstrap ONLY: delete a different core identity already holding this email (a
   * previous seed's leftover). Application flows never set it — they refuse the clash.
   */
  readonly replaceEmailClash?: boolean;
}

/**
 * Creates (or refreshes) the full core identity for a WMS user: core."user" +
 * credential core.account + core.member of the warehouse's org + the warehouse's
 * user_profiles row. Idempotent: re-running (bootstrap, reseeding) updates in place.
 *
 * Multi-org safety: an identity that also belongs to ANOTHER organization keeps its own
 * name, email and credential (only the warehouse-local profile and membership are written),
 * and an existing owner/admin membership is never downgraded.
 */
export async function upsertCoreIdentity(db: AppDb, input: CoreIdentityInput): Promise<void> {
  const createdAt = input.createdAt ?? new Date();
  const email = input.email.trim().toLowerCase();
  const hash =
    input.passwordHash ?? (input.password !== undefined ? await hashPassword(input.password) : null);

  const orgId = await warehouseOrgId(db, createdAt);

  // An email already held by a DIFFERENT core identity. Application flows refuse it (an
  // admin must never be able to delete someone's account by typing their email). Reseeding
  // (`replaceEmailClash`) removes a previous seed's leftover — sessions/accounts/members/
  // profile cascade — and only when that identity belongs to no other organization.
  const emailClash = (
    await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  )[0];
  if (emailClash && emailClash.id !== input.userId) {
    if (!input.replaceEmailClash || !(await identityManagedHere(db, emailClash.id))) {
      throw new AppError('VALIDATION', 'This email already belongs to another KitStak account', {
        fieldErrors: { email: ['This email already belongs to another KitStak account'] },
      });
    }
    await db.delete(user).where(eq(user.id, emailClash.id));
  }

  const shared = !(await identityManagedHere(db, input.userId));
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
      // A shared identity's name/email are its owner's to change (no-op update).
      set: shared ? { updatedAt: new Date() } : { name: input.name, email, updatedAt: new Date() },
    });

  if (hash !== null && !shared) {
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

  const membership = (
    await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, input.userId)))
      .limit(1)
  )[0];
  const orgRole = orgRoleForLegacy(input.legacyRole);
  if (!membership) {
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: input.userId,
      role: orgRole,
      createdAt,
    });
  } else if (!membership.role.split(',').some((r) => PRESERVED_ORG_ROLES.has(r.trim()))) {
    // An owner/admin role granted in the portal is kept as is.
    await db.update(member).set({ role: orgRole }).where(eq(member.id, membership.id));
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
